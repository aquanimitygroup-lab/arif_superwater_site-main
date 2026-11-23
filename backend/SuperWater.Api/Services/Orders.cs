using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using SuperWater.Api.Infrastructure;
using SuperWater.Api.Models;
using SuperWater.Api.Payments;

namespace SuperWater.Api.Services;

public sealed record PaymentMethod(string Id, string Label, [property: System.Text.Json.Serialization.JsonPropertyName("needsEmail")] bool NeedsEmail);

public sealed record CheckoutOptions(List<PaymentMethod> Methods, int DeliveryFee, int FreeOver, List<string> Areas);

/// <summary>Orders from the website, payments and staff actions (port of lib/orders.js).</summary>
public sealed class Orders(Db db, Gateways gateways, ILogger<Orders> log)
{
    private const int UnpaidOnlineExpiryHours = 2;

    /// <summary>Payment choices offered at checkout right now.</summary>
    public async Task<CheckoutOptions> CheckoutOptions(JsonObject? content = null)
    {
        var c = content ?? await Content.All(db);
        var methods = new List<PaymentMethod>();
        if (Content.Bool(c, "order.cod_enabled")) methods.Add(new(Gateways.CodId, Gateways.CodLabel, false));
        if (Content.Bool(c, "order.online_enabled"))
            foreach (var g in gateways.Configured()) methods.Add(new(g.Id, g.Label, g.NeedsEmail));
        var areas = Content.Text(c, "order.areas").Split('\n').Select(s => s.Trim()).Where(s => s.Length > 0).ToList();
        return new CheckoutOptions(methods, Content.Number(c, "order.delivery_fee"), Content.Number(c, "order.free_over"), areas);
    }

    public static int DeliveryFee(int subtotal, CheckoutOptions options)
    {
        if (options.FreeOver > 0 && subtotal >= options.FreeOver) return 0;
        return options.DeliveryFee;
    }

    private static string NormalisePhone(JsonObject input)
    {
        var raw = Js.OrEmpty(input, "phone");
        var digits = Regex.Replace(Regex.Replace(raw, @"[^\d+]", ""), @"^\+?88", "");
        if (!Regex.IsMatch(digits, @"^01[3-9]\d{8}$")) throw new HttpError(400, "Enter a valid Bangladeshi mobile number, for example 01712345678.");
        return digits;
    }

    private static string NewCode()
    {
        var d = DateTimeOffset.UtcNow.AddHours(6); // Bangladesh time for the date part
        return $"SW-{d:yyMMdd}-{RandomNumberGenerator.GetInt32(1000, 10000)}";
    }

    private static readonly Regex EmailRe = new(@"^[^\s@]+@[^\s@]+\.[^\s@]+$");

    public sealed record Created(Order Order, string? RedirectUrl);

    /// <summary>
    /// Creates an order from the website. Prices always come from the database,
    /// never from the browser. Stock is reserved in the same transaction.
    /// </summary>
    public async Task<Created> Create(JsonObject input, Func<string, string, string, string> returnUrlFor)
    {
        var options = await CheckoutOptions();
        var method = Js.OrEmpty(input, "payment_method");
        var chosen = options.Methods.FirstOrDefault(m => m.Id == method) ?? throw new HttpError(400, "Choose a payment method.");

        var customerName = Http.Str(input, "name", "Your name", max: 80, required: true, min: 2);
        var phone = NormalisePhone(input);
        var email = Http.Str(input, "email", "Email", max: 120) is { Length: > 0 } e ? e : null;
        var address = Http.Str(input, "address", "Delivery address", max: 300, required: true, min: 5);
        var city = Http.Str(input, "city", "Area or city", max: 60, required: true);
        var note = Http.Str(input, "note", "Note", max: 300) is { Length: > 0 } n ? n : null;
        if (email is not null && !EmailRe.IsMatch(email)) throw new HttpError(400, "Enter a valid email address, or leave it empty.");
        if (chosen.NeedsEmail && email is null) throw new HttpError(400, $"{chosen.Label} needs your email address for the receipt.");
        if (options.Areas.Count > 0 && !options.Areas.Contains(city)) throw new HttpError(400, "Choose a delivery area from the list.");

        if (input["items"] is not JsonArray list || list.Count == 0) throw new HttpError(400, "Your cart is empty.");
        if (list.Count > 20) throw new HttpError(400, "Too many different items in one order.");
        var wanted = new List<(string Sku, int Qty)>();
        foreach (var node in list)
        {
            var it = node as JsonObject;
            var qty = it is null ? double.NaN : Js.ToNumber(it, "qty");
            if (!Js.IsInteger(qty) || qty < 1 || qty > 50) throw new HttpError(400, "Each item quantity must be between 1 and 50.");
            var sku = it!.ContainsKey("sku") ? Js.ToStr(it["sku"]) : "undefined";
            var i = wanted.FindIndex(w => w.Sku == sku);
            if (i < 0) wanted.Add((sku, (int)qty)); else wanted[i] = (sku, wanted[i].Qty + (int)qty);
        }
        var skus = wanted.Select(w => w.Sku).ToArray();
        var products = await db.Query<Product>("SELECT sku, name, size_ml, bottles, price, active FROM dbo.products WHERE sku IN @skus", new { skus });
        var items = wanted.Select(w =>
        {
            var p = products.FirstOrDefault(x => x.Sku == w.Sku);
            if (p is null || !p.Active) throw new HttpError(400, "One of the items in your cart is no longer available. Please refresh the page.");
            return new OrderItem { Sku = w.Sku, Name = p.Name, Qty = w.Qty, Price = p.Price, SizeMl = p.SizeMl, Bottles = p.Bottles };
        }).ToList();
        var subtotal = items.Sum(i => i.Price * i.Qty);
        var deliveryFee = DeliveryFee(subtotal, options);
        var total = subtotal + deliveryFee;

        Order? order = null;
        for (var attempt = 0; attempt < 5 && order is null; attempt++)
        {
            try
            {
                order = await db.Begin(async tx =>
                {
                    var code = NewCode();
                    var row = await tx.One<Order>(@"
                        INSERT INTO dbo.orders (code, public_token, customer_name, phone, email, address, city, note,
                                                items, subtotal, delivery_fee, total, payment_method, payment_status)
                        OUTPUT INSERTED.*
                        VALUES (@code, @token, @customerName, @phone, @email, @address, @city, @note,
                                @items, @subtotal, @deliveryFee, @total, @method, @paymentStatus)",
                        new
                        {
                            code, token = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant(),
                            customerName, phone, email, address, city, note,
                            items = JsonSerializer.Serialize(items, Http.JsonOptions), subtotal, deliveryFee, total,
                            method, paymentStatus = method == Gateways.CodId ? "unpaid" : "pending",
                        });
                    await Inventory.Reserve(tx, items, code);
                    return row!;
                });
            }
            catch (Exception ex) when (Db.IsUniqueViolation(ex))
            {
                // order code already used; try another
            }
        }
        if (order is null) throw new HttpError(500, "Could not create the order. Please try again.");

        if (method == Gateways.CodId) return new Created(order, null);

        // Online payment: start it with the gateway.
        var g = gateways.Find(method)!;
        try
        {
            var started = await g.Start(order, action => returnUrlFor(g.Id, action, order.Code), db);
            await db.Execute("UPDATE dbo.orders SET provider_ref = @r, updated_at = SYSDATETIMEOFFSET() WHERE id = @id", new { r = started.ProviderRef, id = order.Id });
            await LogPayment(order.Code, g.Id, "init", true, started.Raw);
            return new Created(order, started.RedirectUrl);
        }
        catch (Exception ex)
        {
            log.LogError(ex, "Payment start failed for {Code}", order.Code);
            await LogPayment(order.Code, g.Id, "init", false, new JsonObject { ["error"] = ex.Message });
            await db.Begin(async tx =>
            {
                var o = (await tx.One<Order>("SELECT * FROM dbo.orders WITH (UPDLOCK, ROWLOCK) WHERE id = @id", new { id = order.Id }))!;
                await Inventory.Release(tx, o, "website");
                await tx.Execute("UPDATE dbo.orders SET status = N'cancelled', payment_status = N'failed', updated_at = SYSDATETIMEOFFSET() WHERE id = @id", new { id = o.Id });
            });
            throw new HttpError(502, $"{g.Label} could not start the payment. Please try again, or choose another payment method.");
        }
    }

    public Task LogPayment(string? orderCode, string provider, string kind, bool ok, JsonObject? payload)
        => db.Execute("INSERT INTO dbo.payment_events (order_code, provider, kind, ok, payload) VALUES (@orderCode, @provider, @kind, @ok, @payload)",
            new { orderCode = string.IsNullOrEmpty(orderCode) ? null : orderCode, provider, kind, ok, payload = (payload ?? new JsonObject()).ToJsonString(Http.JsonOptions) });

    /// <summary>Applies a gateway's verified result to the order. Safe to call more than once.</summary>
    public async Task<Order?> ApplyPayment(HandleResult result, string provider)
    {
        if (string.IsNullOrEmpty(result.OrderCode) || result.Outcome == "pending") return null;
        return await db.Begin(async tx =>
        {
            var o = await tx.One<Order>("SELECT * FROM dbo.orders WITH (UPDLOCK, ROWLOCK) WHERE code = @code", new { code = result.OrderCode });
            if (o is null || o.PaymentMethod != provider) return null;
            if (result.Outcome == "paid")
            {
                if (o.PaymentStatus == "paid") return o;
                if (result.Amount is { } amount && (double.IsNaN(amount) || Math.Abs(amount - o.Total) > 0.5))
                {
                    // Wrong amount: never accept it. Cancel, return the stock, and leave a note so staff can refund.
                    var warning = $"Gateway reported Tk {Js.NumberToString(amount)}, but the order total is Tk {o.Total}. Payment not accepted; refund the customer through the gateway.";
                    await Inventory.Release(tx, o, provider);
                    return await tx.One<Order>(@"UPDATE dbo.orders SET payment_status = N'failed', status = N'cancelled',
                                                   note = CONCAT_WS(N' | ', note, @warning), updated_at = SYSDATETIMEOFFSET()
                                                 OUTPUT INSERTED.* WHERE id = @id", new { warning, id = o.Id });
                }
                return await tx.One<Order>(@"UPDATE dbo.orders SET payment_status = N'paid',
                                               status = CASE WHEN status = N'pending' THEN N'confirmed' ELSE status END,
                                               provider_ref = COALESCE(@ref, provider_ref), updated_at = SYSDATETIMEOFFSET()
                                             OUTPUT INSERTED.* WHERE id = @id", new { @ref = string.IsNullOrEmpty(result.ProviderRef) ? null : result.ProviderRef, id = o.Id });
            }
            // failed or cancelled
            if (o.PaymentStatus == "paid" || o.Status != "pending") return o;
            await Inventory.Release(tx, o, provider);
            return await tx.One<Order>("UPDATE dbo.orders SET payment_status = N'failed', status = N'cancelled', updated_at = SYSDATETIMEOFFSET() OUTPUT INSERTED.* WHERE id = @id", new { id = o.Id });
        });
    }

    /// <summary>Online orders never paid within the time limit are cancelled and their stock returned.</summary>
    public async Task<int> ExpireUnpaid()
    {
        var stale = await db.Query<int>(@"SELECT id FROM dbo.orders WHERE payment_method <> N'cod' AND status = N'pending'
                                          AND payment_status IN (N'unpaid', N'pending') AND created_at < DATEADD(hour, -@h, SYSDATETIMEOFFSET())",
            new { h = UnpaidOnlineExpiryHours });
        foreach (var id in stale)
        {
            await db.Begin(async tx =>
            {
                var o = (await tx.One<Order>("SELECT * FROM dbo.orders WITH (UPDLOCK, ROWLOCK) WHERE id = @id", new { id }))!;
                if (o.Status != "pending" || o.PaymentStatus == "paid") return;
                await Inventory.Release(tx, o, "system");
                await tx.Execute("UPDATE dbo.orders SET status = N'cancelled', payment_status = N'failed', updated_at = SYSDATETIMEOFFSET() WHERE id = @id", new { id });
            });
        }
        return stale.Count;
    }

    /// <summary>Status changes made by staff in the admin.</summary>
    public Task<Order> StaffAction(int orderId, string action, string actor) => db.Begin(async tx =>
    {
        var o = await tx.One<Order>("SELECT * FROM dbo.orders WITH (UPDLOCK, ROWLOCK) WHERE id = @id", new { id = orderId })
                ?? throw new HttpError(404, "Order not found.");
        async Task<Order> Set(string assignments, object? args = null)
        {
            var p = new Dapper.DynamicParameters(args);
            p.Add("id", o.Id);
            return (await tx.One<Order>($"UPDATE dbo.orders SET {assignments}, updated_at = SYSDATETIMEOFFSET() OUTPUT INSERTED.* WHERE id = @id", p))!;
        }
        switch (action)
        {
            case "confirm":
                if (o.Status != "pending") throw new HttpError(409, "Only new orders can be confirmed.");
                return await Set("status = N'confirmed'");
            case "dispatch":
                if (o.Status is not ("pending" or "confirmed")) throw new HttpError(409, "Only new or confirmed orders can be dispatched.");
                if (o.PaymentMethod != Gateways.CodId && o.PaymentStatus != "paid") throw new HttpError(409, "This online order has not been paid yet.");
                await Inventory.Dispatch(tx, o, actor);
                return await Set("status = N'dispatched'");
            case "deliver":
                if (o.Status != "dispatched") throw new HttpError(409, "Only dispatched orders can be marked delivered.");
                return o.PaymentMethod == Gateways.CodId
                    ? await Set("status = N'delivered', payment_status = N'paid'")
                    : await Set("status = N'delivered'");
            case "cancel":
                if (o.Status is not ("pending" or "confirmed")) throw new HttpError(409, "Orders that have left the facility cannot be cancelled here.");
                await Inventory.Release(tx, o, actor);
                return await Set("status = N'cancelled'");
            case "mark_paid":
                return await Set("payment_status = N'paid'");
            case "mark_refunded":
                if (o.PaymentStatus != "paid") throw new HttpError(409, "Only paid orders can be marked refunded.");
                return await Set("payment_status = N'refunded'");
            default:
                throw new HttpError(400, "Unknown action.");
        }
    });

    /// <summary>What the customer may see about their own order.</summary>
    public static object PublicOrder(Order o) => new
    {
        code = o.Code, status = o.Status, payment_status = o.PaymentStatus, payment_method = o.PaymentMethod,
        items = o.Items.Select(i => new { name = i.Name, qty = i.Qty, price = i.Price }),
        subtotal = o.Subtotal, delivery_fee = o.DeliveryFee, total = o.Total,
        customer_name = o.CustomerName, city = o.City, created_at = o.CreatedAt,
    };
}
