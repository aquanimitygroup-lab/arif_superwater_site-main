using System.Text.Json.Nodes;
using SuperWater.Api.Infrastructure;
using SuperWater.Api.Models;

namespace SuperWater.Api.Payments;

/// <summary>
/// TEMPLATE for adding another payment gateway (for example Nagad, AamarPay,
/// ShurjoPay or Stripe). It is not registered, so it never appears at checkout.
///
/// 1. Copy this file to Payments/&lt;Name&gt;Gateway.cs and fill in the methods.
/// 2. Register it in Program.cs:  builder.Services.AddSingleton&lt;IPaymentGateway, NameGateway&gt;();
/// 3. Add its keys to the server settings (appsettings.json or environment variables, never in the code).
///
/// The gateway sends customers (and, if it has one, its server-to-server notification) to:
///   https://&lt;your-site&gt;/api/payment?provider=&lt;id&gt;&amp;action=&lt;anything&gt;&amp;order=&lt;order code&gt;
/// returnUrl("success") builds that address for you.
/// </summary>
public sealed class TemplateGateway(IConfiguration config) : IPaymentGateway
{
    private string Env(string k) => (config[k] ?? "").Trim();

    public string Id => "example";              // used in URLs and stored on orders
    public string Label => "Example gateway";   // shown to customers at checkout
    public bool NeedsEmail => false;            // true if the gateway requires the customer's email

    /// <summary>Return true once all required keys are set. Unconfigured gateways are hidden.</summary>
    public bool Configured() => Env("EXAMPLE_API_KEY").Length > 0;

    /// <summary>
    /// Start a payment. order has Code, Total (Taka), CustomerName, Phone, Email,
    /// Address, City and Items. Return the page to send the customer to.
    /// </summary>
    public Task<StartResult> Start(Order order, Func<string, string> returnUrl, Db db)
    {
        throw new NotImplementedException();
        // return Task.FromResult(new StartResult("https://gateway/pay/…", "their payment id", null));
    }

    /// <summary>
    /// Called when the gateway sends the customer back or notifies us.
    /// Always confirm with the gateway's own API before returning "paid".
    /// Outcome: "paid" | "failed" | "cancelled" | "pending" (not known yet)
    /// </summary>
    public Task<HandleResult> Handle(string action, Dictionary<string, string> query, JsonObject body, Db db)
    {
        query.TryGetValue("order", out var code);
        return Task.FromResult(new HandleResult(code, "pending", new JsonObject { ["action"] = action }));
        // return new HandleResult(orderCode, "paid", raw, Amount: 720, ProviderRef: "TRX123");
    }
}
