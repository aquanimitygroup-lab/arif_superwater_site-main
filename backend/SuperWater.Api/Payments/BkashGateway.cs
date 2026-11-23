using System.Globalization;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json.Nodes;
using SuperWater.Api.Infrastructure;
using SuperWater.Api.Models;
using static SuperWater.Api.Payments.GatewayHttp;

namespace SuperWater.Api.Payments;

/// <summary>
/// bKash Tokenized Checkout (without agreement).
/// https://developer.bka.sh/
///
/// Settings:
///   BKASH_USERNAME, BKASH_PASSWORD     merchant credentials (sent as headers)
///   BKASH_APP_KEY, BKASH_APP_SECRET    app credentials
///   BKASH_BASE_URL                     defaults to the sandbox:
///                                      https://tokenized.sandbox.bka.sh/v2/tokenized-checkout
///                                      For live payments, set the live base URL bKash gives you at onboarding.
///
/// Flow: get a token (cached in the database: bKash blocks apps that request
/// tokens too often), create a payment and send the customer to bkashURL.
/// bKash returns them to our callback with ?paymentID=…&amp;status=success|failure|cancel.
/// On success we execute the payment; it only counts when transactionStatus is "Completed".
/// </summary>
public sealed class BkashGateway(IConfiguration config) : IPaymentGateway
{
    private string Env(string k) => (config[k] ?? "").Trim();
    private string Base => (Env("BKASH_BASE_URL") is { Length: > 0 } b ? b : "https://tokenized.sandbox.bka.sh/v2/tokenized-checkout").TrimEnd('/');

    public string Id => "bkash";
    public string Label => "bKash";
    public bool NeedsEmail => false;

    public bool Configured() => new[] { "BKASH_USERNAME", "BKASH_PASSWORD", "BKASH_APP_KEY", "BKASH_APP_SECRET" }.All(k => Env(k).Length > 0);

    private async Task<JsonObject> Call(string path, Dictionary<string, string> headers, JsonObject body)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, $"{Base}{path}")
        {
            Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json"),
        };
        req.Headers.Accept.ParseAdd("application/json");
        foreach (var (k, v) in headers) req.Headers.TryAddWithoutValidation(k, v);
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        using var r = await Client.SendAsync(req, cts.Token);
        return await JsonOrEmpty(r);
    }

    private static long Now() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    private async Task<string> Token(Db db)
    {
        var savedText = await db.One<string>("SELECT value FROM dbo.app_state WHERE [key] = N'bkash_token'");
        var saved = savedText is null ? null : JsonNode.Parse(savedText) as JsonObject;
        if (saved is not null && S(saved, "id_token").Length > 0 && Js.ToNumber(saved, "expires_at") > Now() + 5 * 60_000) return S(saved, "id_token");

        var auth = new Dictionary<string, string> { ["username"] = Env("BKASH_USERNAME"), ["password"] = Env("BKASH_PASSWORD") };
        JsonObject Creds() => new() { ["app_key"] = Env("BKASH_APP_KEY"), ["app_secret"] = Env("BKASH_APP_SECRET") };
        JsonObject? data = null;
        if (saved is not null && S(saved, "refresh_token").Length > 0 && Js.ToNumber(saved, "refresh_expires_at") > Now())
        {
            var b = Creds(); b["refresh_token"] = S(saved, "refresh_token");
            data = await Call("/auth/refresh-token", auth, b);
        }
        if (data is null || S(data, "id_token").Length == 0) data = await Call("/auth/grant-token", auth, Creds());
        if (S(data, "id_token").Length == 0)
        {
            var msg = S(data, "statusMessage") is { Length: > 0 } m ? m : S(data, "errorMessageEn") is { Length: > 0 } e ? e : "no token returned";
            throw new Exception($"bKash refused the token request: {msg}");
        }

        var expiresIn = Js.ToNumber(data, "expires_in");
        var hasRefresh = S(data, "refresh_token").Length > 0;
        var value = new JsonObject
        {
            ["id_token"] = S(data, "id_token"),
            ["refresh_token"] = hasRefresh ? S(data, "refresh_token") : saved?["refresh_token"]?.DeepClone(),
            ["expires_at"] = Now() + (long)((expiresIn is > 0 && !double.IsNaN(expiresIn) ? expiresIn : 3600) * 1000),
            ["refresh_expires_at"] = hasRefresh ? Now() + 29L * 24 * 3600_000 : saved?["refresh_expires_at"]?.DeepClone(),
        };
        var json = value.ToJsonString();
        var updated = await db.Execute("UPDATE dbo.app_state SET value = @json, updated_at = SYSDATETIMEOFFSET() WHERE [key] = N'bkash_token'", new { json });
        if (updated == 0)
        {
            try { await db.Execute("INSERT INTO dbo.app_state ([key], value) VALUES (N'bkash_token', @json)", new { json }); }
            catch (Exception e) when (Db.IsUniqueViolation(e))
            {
                await db.Execute("UPDATE dbo.app_state SET value = @json, updated_at = SYSDATETIMEOFFSET() WHERE [key] = N'bkash_token'", new { json });
            }
        }
        return S(value, "id_token");
    }

    private Dictionary<string, string> AuthHeaders(string t) => new() { ["Authorization"] = t, ["X-App-Key"] = Env("BKASH_APP_KEY") };

    public async Task<StartResult> Start(Order order, Func<string, string> returnUrl, Db db)
    {
        var t = await Token(db);
        var data = await Call("/payment/create", AuthHeaders(t), new JsonObject
        {
            ["payerReference"] = order.Phone,
            ["callbackURL"] = returnUrl("callback"),
            ["amount"] = order.Total.ToString("F2", CultureInfo.InvariantCulture),
            ["currency"] = "BDT",
            ["intent"] = "sale",
            ["merchantInvoiceNumber"] = order.Code,
        });
        var paymentId = S(data, "paymentId") is { Length: > 0 } a ? a : S(data, "paymentID");
        if (paymentId.Length == 0 || S(data, "bkashURL").Length == 0)
        {
            var msg = S(data, "statusMessage") is { Length: > 0 } m ? m : S(data, "errorMessageEn") is { Length: > 0 } e ? e : "no payment link returned";
            throw new Exception($"bKash did not start the payment: {msg}");
        }
        return new StartResult(S(data, "bkashURL"), paymentId, new JsonObject { ["transactionStatus"] = Copy(data, "transactionStatus") });
    }

    public async Task<HandleResult> Handle(string action, Dictionary<string, string> query, JsonObject body, Db db)
    {
        string? Q(string k) => query.TryGetValue(k, out var v) ? v : null;
        var orderCode = Q("order");
        var paymentId = !string.IsNullOrEmpty(Q("paymentID")) ? Q("paymentID") : Q("paymentId");
        var status = Q("status");
        if (status == "cancel") return new HandleResult(orderCode, "cancelled", new JsonObject { ["status"] = status });
        if (status != "success" || string.IsNullOrEmpty(paymentId)) return new HandleResult(orderCode, "failed", new JsonObject { ["status"] = status });

        var t = await Token(db);
        JsonObject? result;
        try { result = await Call("/payment/execute", AuthHeaders(t), new JsonObject { ["paymentId"] = paymentId }); }
        catch { result = null; }
        if (result is null || S(result, "transactionStatus").Length == 0)
        {
            // bKash advises checking the status if execute gives no clear answer.
            try { result = await Call("/query/payment", AuthHeaders(t), new JsonObject { ["paymentId"] = paymentId }); }
            catch { result = new JsonObject(); }
        }
        var invoice = S(result, "merchantInvoiceNumber") is { Length: > 0 } inv ? inv : S(result, "merchantInvoice");
        var ok = S(result, "transactionStatus") == "Completed" && (invoice.Length == 0 || invoice == orderCode);
        var trx = S(result, "trxId");
        return new HandleResult(orderCode, ok ? "paid" : "failed",
            new JsonObject
            {
                ["status"] = status, ["transactionStatus"] = Copy(result, "transactionStatus"), ["trxId"] = Copy(result, "trxId"),
                ["amount"] = Copy(result, "amount"),
                ["message"] = result["statusMessage"] is not null && S(result, "statusMessage").Length > 0 ? Copy(result, "statusMessage") : Copy(result, "errorMessageEn"),
            },
            ok ? Js.ToNumber(result["amount"]) : null,
            trx.Length > 0 ? trx : paymentId);
    }
}
