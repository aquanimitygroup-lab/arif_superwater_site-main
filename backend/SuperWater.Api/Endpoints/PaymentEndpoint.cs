using System.Text.Json.Nodes;
using SuperWater.Api.Infrastructure;
using SuperWater.Api.Payments;
using SuperWater.Api.Services;

namespace SuperWater.Api.Endpoints;

/// <summary>
/// Where payment gateways send customers back, and their server notifications (port of api/payment.js).
///   /api/payment?provider=&lt;id&gt;&amp;action=&lt;success|fail|cancel|ipn|callback&gt;&amp;order=&lt;code&gt;
/// </summary>
public static class PaymentEndpoint
{
    public static async Task Handle(HttpContext ctx)
    {
        var sp = ctx.RequestServices;
        await sp.GetRequiredService<Schema>().Ensure();
        var db = sp.GetRequiredService<Db>();
        var orders = sp.GetRequiredService<Orders>();
        var q = Http.Query(ctx);
        var all = sp.GetRequiredService<Gateways>();
        await all.Load(db);
        var g = all.Find(Http.Q(q, "provider"));
        if (g is null || !g.Configured()) throw new HttpError(404, "Unknown payment provider.");

        var action = Http.Q(q, "action");
        var b = ctx.Request.Method == "POST" ? await Http.Body(ctx) : new JsonObject();
        HandleResult result;
        try
        {
            result = await g.Handle(action, q, b, db);
        }
        catch (Exception e)
        {
            sp.GetRequiredService<ILoggerFactory>().CreateLogger("SuperWater.Payment").LogError(e, "Gateway handler failed");
            result = new HandleResult(q.TryGetValue("order", out var oc) ? oc : null, "pending", new JsonObject { ["error"] = e.Message });
        }
        var payload = new JsonObject { ["outcome"] = result.Outcome };
        foreach (var (k, v) in result.Raw) payload[k] = v?.DeepClone();
        await orders.LogPayment(result.OrderCode, g.Id, action == "ipn" ? "ipn" : "callback", result.Outcome == "paid", payload);
        await orders.ApplyPayment(result, g.Id);

        // Server-to-server notifications just need an acknowledgement.
        if (action == "ipn") { await Http.Send(ctx, 200, new { received = true }); return; }

        // Customers go to their order page, which shows the result.
        var code = !string.IsNullOrEmpty(result.OrderCode) ? result.OrderCode : Http.Q(q, "order");
        var o = await db.One<Models.Order>("SELECT code, public_token FROM dbo.orders WHERE code = @code", new { code });
        if (o is null) { await Http.Redirect(ctx, "/?payment=unknown#shop"); return; }
        await Http.Redirect(ctx, $"/order?code={Uri.EscapeDataString(o.Code)}&token={o.PublicToken}");
    }
}
