using SuperWater.Api.Infrastructure;
using SuperWater.Api.Models;

namespace SuperWater.Api.Services;

/// <summary>
/// Stock is counted in bottles per size at the production facility (port of lib/inventory.js).
///   on_hand   bottles physically at the facility
///   reserved  bottles promised to website orders not yet dispatched
///   available on_hand - reserved (what the website can still sell)
///
/// Order life cycle and what it does to stock:
///   order placed      reserved += bottles
///   order cancelled   reserved -= bottles            (if still reserved)
///   order dispatched  on_hand -= bottles, reserved -= bottles
/// Every change is written to stock_movements.
/// Rows are locked with UPDLOCK inside transactions (Postgres: SELECT … FOR UPDATE).
/// </summary>
public static class Inventory
{
    public static readonly int[] Sizes = [500, 2000];
    public static string SizeLabel(int ml) => ml == 2000 ? "2 L" : $"{ml} mL";

    /// <summary>Bottles needed per size for a list of order items (in first-seen order).</summary>
    public static List<KeyValuePair<int, int>> BottlesBySize(IEnumerable<OrderItem> items)
    {
        var need = new List<KeyValuePair<int, int>>();
        foreach (var it in items)
        {
            var i = need.FindIndex(x => x.Key == it.SizeMl);
            if (i < 0) need.Add(new(it.SizeMl, it.Bottles * it.Qty));
            else need[i] = new(it.SizeMl, need[i].Value + it.Bottles * it.Qty);
        }
        // Object keys that are integers iterate in ascending order in JavaScript.
        need.Sort((a, b) => a.Key.CompareTo(b.Key));
        return need;
    }

    public static async Task<List<StockLevel>> Levels(Db db)
    {
        var rows = await db.Query<StockLevel>("SELECT size_ml, on_hand, reserved, low_threshold, updated_at FROM dbo.stock ORDER BY size_ml");
        foreach (var r in rows) { r.Available = r.OnHand - r.Reserved; r.Low = r.OnHand - r.Reserved <= r.LowThreshold; }
        return rows;
    }

    private sealed class Row { public int SizeMl { get; set; } public int OnHand { get; set; } public int Reserved { get; set; } }

    /// <summary>Locks the stock rows, checks there is enough, and reserves. Call inside db.Begin().</summary>
    public static async Task Reserve(Tx tx, List<OrderItem> items, string orderCode)
    {
        var need = BottlesBySize(items);
        var sizes = need.Select(n => n.Key).ToArray();
        var rows = await tx.Query<Row>("SELECT size_ml, on_hand, reserved FROM dbo.stock WITH (UPDLOCK, ROWLOCK) WHERE size_ml IN @sizes ORDER BY size_ml", new { sizes });
        foreach (var r in rows)
        {
            var available = r.OnHand - r.Reserved;
            var wanted = need.First(n => n.Key == r.SizeMl).Value;
            if (available < wanted)
                throw new HttpError(409, available <= 0
                    ? $"Sorry, {SizeLabel(r.SizeMl)} bottles are out of stock right now."
                    : $"Sorry, we only have {available} {SizeLabel(r.SizeMl)} bottle{(available == 1 ? "" : "s")} left. Please reduce your order.");
        }
        foreach (var (size, n) in need)
        {
            await tx.Execute("UPDATE dbo.stock SET reserved = reserved + @n, updated_at = SYSDATETIMEOFFSET() WHERE size_ml = @size", new { n, size });
            await tx.Execute(@"INSERT INTO dbo.stock_movements (size_ml, reserved_change, reason, ref, actor)
                               VALUES (@size, @n, N'order_reserved', @orderCode, N'website')", new { size, n, orderCode });
        }
    }

    /// <summary>Gives reserved bottles back when an order is cancelled before dispatch.</summary>
    public static async Task Release(Tx tx, Order order, string actor)
    {
        if (order.StockState != "reserved") return;
        foreach (var (size, n) in BottlesBySize(order.Items))
        {
            await tx.Execute(@"UPDATE dbo.stock SET reserved = CASE WHEN reserved - @n > 0 THEN reserved - @n ELSE 0 END,
                               updated_at = SYSDATETIMEOFFSET() WHERE size_ml = @size", new { n, size });
            await tx.Execute(@"INSERT INTO dbo.stock_movements (size_ml, reserved_change, reason, ref, actor)
                               VALUES (@size, @change, N'order_released', @code, @actor)", new { size, change = -n, code = order.Code, actor });
        }
        await tx.Execute("UPDATE dbo.orders SET stock_state = N'released', updated_at = SYSDATETIMEOFFSET() WHERE id = @id", new { id = order.Id });
        order.StockState = "released";
    }

    /// <summary>Takes bottles out of the facility when an order leaves.</summary>
    public static async Task Dispatch(Tx tx, Order order, string actor)
    {
        if (order.StockState != "reserved") throw new HttpError(409, "This order no longer holds stock, so it cannot be dispatched. Place a new order instead.");
        foreach (var (size, n) in BottlesBySize(order.Items))
        {
            var onHand = await tx.One<int>("SELECT on_hand FROM dbo.stock WITH (UPDLOCK, ROWLOCK) WHERE size_ml = @size", new { size });
            if (onHand < n) throw new HttpError(409, $"The facility only has {onHand} {SizeLabel(size)} bottles on hand. Record production or a stock count first.");
            await tx.Execute(@"UPDATE dbo.stock SET on_hand = on_hand - @n, reserved = CASE WHEN reserved - @n > 0 THEN reserved - @n ELSE 0 END,
                               updated_at = SYSDATETIMEOFFSET() WHERE size_ml = @size", new { n, size });
            await tx.Execute(@"INSERT INTO dbo.stock_movements (size_ml, on_hand_change, reserved_change, reason, ref, actor)
                               VALUES (@size, @change, @change, N'order_dispatched', @code, @actor)", new { size, change = -n, code = order.Code, actor });
        }
        await tx.Execute("UPDATE dbo.orders SET stock_state = N'dispatched', updated_at = SYSDATETIMEOFFSET() WHERE id = @id", new { id = order.Id });
        order.StockState = "dispatched";
    }

    /// <summary>New bottles produced at the facility.</summary>
    public static Task AddProduction(Db db, double sizeMl, double quantity, string? batch, string? note, string actor)
    {
        var size = CheckSize(sizeMl);
        if (!Js.IsInteger(quantity) || quantity <= 0 || quantity > 1_000_000) throw new HttpError(400, "Quantity must be a whole number above 0.");
        var q = (int)quantity;
        return db.Begin(async tx =>
        {
            await tx.Execute("UPDATE dbo.stock SET on_hand = on_hand + @q, updated_at = SYSDATETIMEOFFSET() WHERE size_ml = @size", new { q, size });
            await tx.Execute(@"INSERT INTO dbo.stock_movements (size_ml, on_hand_change, reason, ref, note, actor)
                               VALUES (@size, @q, N'production', @batch, @note, @actor)",
                new { size, q, batch = string.IsNullOrEmpty(batch) ? null : batch, note = string.IsNullOrEmpty(note) ? null : note, actor });
        });
    }

    public sealed record StocktakeResult(int Previous, int Counted, int Change);

    /// <summary>A physical count at the facility replaces the on-hand number.</summary>
    public static Task<StocktakeResult> Stocktake(Db db, double sizeMl, double counted, string? note, string actor)
    {
        var size = CheckSize(sizeMl);
        if (!Js.IsInteger(counted) || counted < 0 || counted > 10_000_000) throw new HttpError(400, "The counted amount must be a whole number, 0 or more.");
        var c = (int)counted;
        return db.Begin(async tx =>
        {
            var previous = await tx.One<int>("SELECT on_hand FROM dbo.stock WITH (UPDLOCK, ROWLOCK) WHERE size_ml = @size", new { size });
            var change = c - previous;
            await tx.Execute("UPDATE dbo.stock SET on_hand = @c, updated_at = SYSDATETIMEOFFSET() WHERE size_ml = @size", new { c, size });
            await tx.Execute(@"INSERT INTO dbo.stock_movements (size_ml, on_hand_change, reason, note, actor)
                               VALUES (@size, @change, N'stocktake', @note, @actor)",
                new { size, change, note = string.IsNullOrEmpty(note) ? null : note, actor });
            return new StocktakeResult(previous, c, change);
        });
    }

    /// <summary>Breakage, samples, returns and similar: adds or removes bottles.</summary>
    public static Task Adjust(Db db, double sizeMl, double change, string note, string actor)
    {
        var size = CheckSize(sizeMl);
        if (!Js.IsInteger(change) || change == 0) throw new HttpError(400, "Enter a whole number other than 0 (negative to remove bottles).");
        if (string.IsNullOrEmpty(note)) throw new HttpError(400, "Give a reason for the adjustment.");
        var ch = (int)change;
        return db.Begin(async tx =>
        {
            var onHand = await tx.One<int>("SELECT on_hand FROM dbo.stock WITH (UPDLOCK, ROWLOCK) WHERE size_ml = @size", new { size });
            if (onHand + ch < 0) throw new HttpError(400, $"That would leave fewer than 0 bottles (there are {onHand}).");
            await tx.Execute("UPDATE dbo.stock SET on_hand = on_hand + @ch, updated_at = SYSDATETIMEOFFSET() WHERE size_ml = @size", new { ch, size });
            await tx.Execute(@"INSERT INTO dbo.stock_movements (size_ml, on_hand_change, reason, note, actor)
                               VALUES (@size, @ch, N'adjustment', @note, @actor)", new { size, ch, note, actor });
        });
    }

    private static int CheckSize(double sizeMl)
    {
        if (sizeMl != 500 && sizeMl != 2000) throw new HttpError(400, "Bottle size must be 500 or 2000 (mL).");
        return (int)sizeMl;
    }
}
