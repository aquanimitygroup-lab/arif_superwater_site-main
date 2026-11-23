using SuperWater.Api.Infrastructure;
using SuperWater.Api.Models;
using SuperWater.Api.Services;

namespace SuperWater.Api.Endpoints;

/// <summary>
/// API for the production facility's own systems (or a script/spreadsheet tool). Port of api/facility.js.
/// Every request needs:  Authorization: Bearer &lt;FACILITY_API_KEY&gt;
///
///   GET  /api/facility                       stock levels and orders waiting for dispatch
///   POST /api/facility?action=production     {"size_ml":500,"quantity":2400,"batch":"B-1121","note":"Line 1"}
///   POST /api/facility?action=stocktake      {"size_ml":500,"counted":5120,"note":"Monthly count"}
/// </summary>
public static class FacilityEndpoint
{
    private const string Actor = "facility-api";

    public static async Task Handle(HttpContext ctx)
    {
        var sp = ctx.RequestServices;
        Auth.RequireFacilityKey(ctx, sp.GetRequiredService<IConfiguration>());
        await sp.GetRequiredService<Schema>().Ensure();
        var db = sp.GetRequiredService<Db>();
        var q = Http.Query(ctx);

        if (ctx.Request.Method == "GET")
        {
            var waiting = await db.Query<Order>(@"SELECT * FROM dbo.orders
                                                  WHERE status IN (N'pending', N'confirmed') AND stock_state = N'reserved' ORDER BY created_at, id");
            await Http.Send(ctx, 200, new
            {
                stock = (await Inventory.Levels(db)).Select(s => new { size_ml = s.SizeMl, on_hand = s.OnHand, reserved = s.Reserved, available = s.Available, low_threshold = s.LowThreshold }),
                orders_to_dispatch = waiting.Select(o => new
                {
                    code = o.Code, created_at = o.CreatedAt, status = o.Status, payment_status = o.PaymentStatus,
                    items = o.Items.Select(i => new { sku = i.Sku, qty = i.Qty, size_ml = i.SizeMl, bottles = i.Bottles * i.Qty }),
                }),
            });
            return;
        }

        if (ctx.Request.Method == "POST")
        {
            var b = await Http.Body(ctx);
            string? Cut(string key, int max)
            {
                if (!Js.Truthy(b, key)) return null;
                var s = Js.ToStr(b[key]);
                return s.Length > max ? s[..max] : s;
            }
            if (Http.Q(q, "action") == "production")
            {
                await Inventory.AddProduction(db, Js.ToNumber(b, "size_ml"), Js.ToNumber(b, "quantity"), Cut("batch", 60), Cut("note", 300), Actor);
                await Http.Send(ctx, 200, new { ok = true, stock = await Inventory.Levels(db) });
                return;
            }
            if (Http.Q(q, "action") == "stocktake")
            {
                var r = await Inventory.Stocktake(db, Js.ToNumber(b, "size_ml"), Js.ToNumber(b, "counted"), Cut("note", 300), Actor);
                await Http.Send(ctx, 200, new { ok = true, previous = r.Previous, counted = r.Counted, change = r.Change, stock = await Inventory.Levels(db) });
                return;
            }
        }
        throw new HttpError(404, "Unknown request. See the comments at the top of Endpoints/FacilityEndpoint.cs.");
    }
}
