using System.Globalization;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.WebUtilities;
using SuperWater.Api.Infrastructure;
using SuperWater.Api.Models;
using static SuperWater.Api.Payments.GatewayHttp;

namespace SuperWater.Api.Payments;

/// <summary>
/// SSLCommerz (cards, mobile banking, internet banking) — API v4.
/// https://developer.sslcommerz.com/doc/v4/
///
/// Settings:
///   SSLCOMMERZ_STORE_ID        your store ID
///   SSLCOMMERZ_STORE_PASSWORD  your store password (API password)
///   SSLCOMMERZ_LIVE            "true" for real payments; anything else uses the sandbox
///
/// Flow: we create a session and send the customer to GatewayPageURL. When they
/// finish, SSLCommerz sends them back (success/fail/cancel) and also calls our
/// IPN address server-to-server. A payment only counts once the validation API
/// confirms it (status VALID or VALIDATED) for the right order and amount.
/// </summary>
public sealed class SslCommerzGateway(PaymentSettings config) : IPaymentGateway
{
    private string Env(string k) => config.Get(k);
    // SSLCOMMERZ_BASE_URL: optional API link set in Admin → Payments; empty uses SSLCommerz's own address.
    private string Base => Env("SSLCOMMERZ_BASE_URL") is { Length: > 0 } b ? b
        : Env("SSLCOMMERZ_LIVE") == "true" ? "https://securepay.sslcommerz.com" : "https://sandbox.sslcommerz.com";

    public string Id => "sslcommerz";
    public string Label => "Card or mobile banking (SSLCommerz)";
    public bool NeedsEmail => true;

    public bool Configured() => config.Enabled("SSLCOMMERZ") && Env("SSLCOMMERZ_STORE_ID").Length > 0 && Env("SSLCOMMERZ_STORE_PASSWORD").Length > 0;

    public async Task<StartResult> Start(Order order, Func<string, string> returnUrl, Db db)
    {
        var postcode = Env("SSLCOMMERZ_DEFAULT_POSTCODE");
        var form = new List<KeyValuePair<string, string>>
        {
            new("store_id", Env("SSLCOMMERZ_STORE_ID")),
            new("store_passwd", Env("SSLCOMMERZ_STORE_PASSWORD")),
            new("total_amount", order.Total.ToString("F2", CultureInfo.InvariantCulture)),
            new("currency", "BDT"),
            new("tran_id", order.Code),
            new("success_url", returnUrl("success")),
            new("fail_url", returnUrl("fail")),
            new("cancel_url", returnUrl("cancel")),
            new("ipn_url", returnUrl("ipn")),
            new("cus_name", order.CustomerName),
            new("cus_email", order.Email ?? "null"),
            new("cus_add1", order.Address),
            new("cus_city", order.City),
            new("cus_postcode", postcode.Length > 0 ? postcode : "1000"),
            new("cus_country", "Bangladesh"),
            new("cus_phone", order.Phone),
            new("shipping_method", "NO"),
            new("num_of_item", order.Items.Sum(i => i.Qty).ToString(CultureInfo.InvariantCulture)),
            new("product_name", Truncate(string.Join(", ", order.Items.Select(i => $"{i.Qty} x {i.Name}")), 250)),
            new("product_category", "Beverage"),
            new("product_profile", "physical-goods"),
        };
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        using var r = await Client.PostAsync($"{Base}/gwprocess/v4/api.php", new FormUrlEncodedContent(form), cts.Token);
        var data = await JsonOrEmpty(r);
        if (S(data, "status") != "SUCCESS" || S(data, "GatewayPageURL").Length == 0)
        {
            var reason = S(data, "failedreason");
            throw new Exception($"SSLCommerz did not start the payment: {(reason.Length > 0 ? reason : ((int)r.StatusCode).ToString())}");
        }
        var session = S(data, "sessionkey");
        return new StartResult(S(data, "GatewayPageURL"), session.Length > 0 ? session : null, new JsonObject { ["status"] = Copy(data, "status") });
    }

    /// <summary>action is success, fail, cancel (customer's browser) or ipn (server-to-server).</summary>
    public async Task<HandleResult> Handle(string action, Dictionary<string, string> query, JsonObject body, Db db)
    {
        var p = new Dictionary<string, string?>();
        foreach (var (k, v) in query) p[k] = v;
        foreach (var (k, v) in body) p[k] = v is null ? null : Js.ToStr(v);
        string? Get(string k) => p.TryGetValue(k, out var v) ? v : null;

        var tran = Get("tran_id");
        var orderCode = !string.IsNullOrEmpty(tran) ? tran : (query.TryGetValue("order", out var o) ? o : null);
        var valId = Get("val_id");
        var status = Get("status");
        if (!string.IsNullOrEmpty(valId))
        {
            var url = QueryHelpers.AddQueryString($"{Base}/validator/api/validationserverAPI.php", new Dictionary<string, string?>
            {
                ["val_id"] = valId, ["store_id"] = Env("SSLCOMMERZ_STORE_ID"), ["store_passwd"] = Env("SSLCOMMERZ_STORE_PASSWORD"), ["format"] = "json",
            });
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(20));
            using var r = await Client.GetAsync(url, cts.Token);
            var v = await JsonOrEmpty(r);
            var vs = S(v, "status");
            var ok = (vs == "VALID" || vs == "VALIDATED") && v["tran_id"] is not null && S(v, "tran_id") == orderCode && S(v, "currency") == "BDT";
            var bankTran = S(v, "bank_tran_id");
            return new HandleResult(orderCode, ok ? "paid" : "failed",
                new JsonObject { ["action"] = action, ["status"] = status, ["validation"] = Copy(v, "status"), ["amount"] = Copy(v, "amount"), ["tran_id"] = Copy(v, "tran_id") },
                ok ? Js.ToNumber(v["amount"]) : null,
                bankTran.Length > 0 ? bankTran : valId);
        }
        if (action == "cancel" || status == "CANCELLED") return new HandleResult(orderCode, "cancelled", new JsonObject { ["action"] = action, ["status"] = status });
        if (action == "fail" || status is "FAILED" or "EXPIRED") return new HandleResult(orderCode, "failed", new JsonObject { ["action"] = action, ["status"] = status });
        // A return without a validation ID: wait for the IPN to confirm.
        return new HandleResult(orderCode, "pending", new JsonObject { ["action"] = action, ["status"] = status });
    }

    private static string Truncate(string s, int n) => s.Length > n ? s[..n] : s;
}
