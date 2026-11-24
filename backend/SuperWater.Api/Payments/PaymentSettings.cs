using SuperWater.Api.Infrastructure;

namespace SuperWater.Api.Payments;

/// <summary>One setting the admin can edit for a gateway.</summary>
public sealed record GatewaySpec(string Id, string Prefix, bool HasMode, SettingField[] Fields);

/// <summary>
/// Payment keys and API links. Values saved in Admin → Payments are stored in the database and win over
/// appsettings.json / environment variables, so keys can be changed without touching the server.
/// </summary>
public sealed class PaymentSettings(IConfiguration config) : AdminSettings(config, "payment_settings")
{
    public static readonly GatewaySpec[] Specs =
    [
        new("sslcommerz", "SSLCOMMERZ", HasMode: true,
        [
            new("SSLCOMMERZ_STORE_ID", "Store ID", false, "From your SSLCommerz merchant panel."),
            new("SSLCOMMERZ_STORE_PASSWORD", "Store password (API password)", true, "Kept secret. Leave empty to keep the saved one."),
            new("SSLCOMMERZ_BASE_URL", "API link (optional)", false, "Leave empty to use SSLCommerz's own address for the chosen mode.", "https://sandbox.sslcommerz.com"),
        ]),
        new("bkash", "BKASH", HasMode: false,
        [
            new("BKASH_USERNAME", "Username", false, "Merchant username from bKash."),
            new("BKASH_PASSWORD", "Password", true, "Kept secret. Leave empty to keep the saved one."),
            new("BKASH_APP_KEY", "App key", false, "bKash app key."),
            new("BKASH_APP_SECRET", "App secret", true, "Kept secret. Leave empty to keep the saved one."),
            new("BKASH_BASE_URL", "API link", false, "Empty uses the bKash sandbox. For real payments paste the live link bKash gave you.", "https://tokenized.sandbox.bka.sh/v2/tokenized-checkout"),
        ]),
    ];

    /// <summary>A gateway is on unless the admin switched it off.</summary>
    public bool Enabled(string prefix) => Get(prefix + "_ENABLED") != "false";
}
