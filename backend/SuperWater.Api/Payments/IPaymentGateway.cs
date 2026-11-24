using System.Text.Json.Nodes;
using SuperWater.Api.Infrastructure;
using SuperWater.Api.Models;

namespace SuperWater.Api.Payments;

/// <summary>The result of starting a payment: where to send the customer.</summary>
public sealed record StartResult(string RedirectUrl, string? ProviderRef, JsonObject? Raw);

/// <summary>
/// What a gateway reported. Outcome: "paid" | "failed" | "cancelled" | "pending" (not known yet).
/// Amount is only set for verified payments.
/// </summary>
public sealed record HandleResult(string? OrderCode, string Outcome, JsonObject Raw, double? Amount = null, string? ProviderRef = null);

/// <summary>
/// An online payment gateway (port of lib/payments/*.js).
/// To add one (Nagad, AamarPay, ShurjoPay, Stripe…), copy TemplateGateway.cs,
/// fill in its methods and add it to <see cref="Gateways.All"/>.
/// </summary>
public interface IPaymentGateway
{
    /// <summary>Used in URLs and stored on orders.</summary>
    string Id { get; }
    /// <summary>Shown to customers at checkout.</summary>
    string Label { get; }
    /// <summary>True if the gateway requires the customer's email.</summary>
    bool NeedsEmail { get; }

    /// <summary>True once all required keys are set. Unconfigured gateways are hidden.</summary>
    bool Configured();

    /// <summary>Start a payment and return the page to send the customer to.</summary>
    Task<StartResult> Start(Order order, Func<string, string> returnUrl, Db db);

    /// <summary>
    /// Called when the gateway sends the customer back or notifies us.
    /// Always confirm with the gateway's own API before returning "paid".
    /// </summary>
    Task<HandleResult> Handle(string action, Dictionary<string, string> query, JsonObject body, Db db);
}

public sealed class Gateways(IEnumerable<IPaymentGateway> gateways, PaymentSettings settings)
{
    /// <summary>Reads the latest keys saved in the admin (cached for a few seconds). Call before using Configured().</summary>
    public Task Load(Db db, bool force = false) => settings.Refresh(db, force);

    public const string CodId = "cod";
    public const string CodLabel = "Cash on delivery";

    /// <summary>
    /// Online payment gateways. A gateway appears at checkout only when its keys
    /// are set AND "Accept online payment" is on in Admin → Website content → Ordering.
    /// </summary>
    public IReadOnlyList<IPaymentGateway> All { get; } = gateways.ToList();

    public IPaymentGateway? Find(string id) => All.FirstOrDefault(g => g.Id == id);

    public IEnumerable<IPaymentGateway> Configured() => All.Where(g => g.Configured());
}

internal static class GatewayHttp
{
    public static readonly HttpClient Client = new();

    /// <summary>Parses a JSON response, or returns an empty object (JS: r.json().catch(() => ({}))).</summary>
    public static async Task<JsonObject> JsonOrEmpty(HttpResponseMessage r)
    {
        try { return JsonNode.Parse(await r.Content.ReadAsStringAsync()) as JsonObject ?? new JsonObject(); }
        catch { return new JsonObject(); }
    }

    public static string S(JsonObject o, string key) => o[key] is null ? "" : Js.ToStr(o[key]);
    public static JsonNode? Copy(JsonObject o, string key) => o[key]?.DeepClone();
}
