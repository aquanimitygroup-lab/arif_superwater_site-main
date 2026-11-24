using SuperWater.Api.Infrastructure;

namespace SuperWater.Api.Services;

/// <summary>
/// Email settings, edited in Admin → Email notifications (stored in the database, like the payment keys).
/// </summary>
public sealed class MailSettings(IConfiguration config) : AdminSettings(config, "mail_settings")
{
    public static readonly string[] Providers = ["smtp", "resend", "sendgrid", "brevo"];

    /// <summary>Plain (non-secret) text settings the admin form edits. Toggles and the provider are handled separately.</summary>
    public static readonly SettingField[] Common =
    [
        new("MAIL_FROM_NAME", "Sender name", false, "Shown as the sender, for example Super Water.", "Super Water"),
        new("MAIL_FROM_EMAIL", "Sender email", false, "Must be an address your email service allows you to send from.", "orders@yourdomain.com"),
        new("MAIL_REPLY_TO", "Reply-to email (optional)", false, "Where customer replies should go.", "support@yourdomain.com"),
        new("MAIL_ADMIN_EMAIL", "New order alerts to (optional)", false, "Your own address. You get a short email for every new order.", "you@yourdomain.com"),
        new("MAIL_FOOTER", "Footer message (optional)", false, "A line added at the bottom of every customer email, for example your phone number or helpline.", "Questions? Call us on 01XXXXXXXXX."),
    ];

    public static readonly SettingField[] Api =
    [
        new("MAIL_API_KEY", "API key", true, "Kept secret. Leave empty to keep the saved one."),
        new("MAIL_API_URL", "API link (optional)", false, "Leave empty to use the service's standard address. Must start with https://.", ""),
    ];

    public static readonly SettingField[] Smtp =
    [
        new("MAIL_SMTP_HOST", "SMTP host", false, "For example smtp.gmail.com or smtp.zoho.com.", "smtp.example.com"),
        new("MAIL_SMTP_PORT", "SMTP port", false, "Usually 587 (STARTTLS) or 465 (SSL).", "587"),
        new("MAIL_SMTP_USER", "SMTP username", false, "Often your full email address."),
        new("MAIL_SMTP_PASSWORD", "SMTP password", true, "Kept secret. Leave empty to keep the saved one. For Gmail use an app password."),
    ];

    public static readonly string[] Toggles = ["MAIL_ENABLED", "MAIL_ON_PLACED", "MAIL_ON_STATUS", "MAIL_ON_PAYMENT"];

    public IEnumerable<SettingField> All => Common.Concat(Api).Concat(Smtp);

    public bool Enabled => Flag("MAIL_ENABLED", false);
    public string Provider => Providers.Contains(Get("MAIL_PROVIDER")) ? Get("MAIL_PROVIDER") : "smtp";
    public string FromEmail => Get("MAIL_FROM_EMAIL");
    public string FromName => Get("MAIL_FROM_NAME") is { Length: > 0 } n ? n : "Super Water";

    /// <summary>All the keys the chosen provider needs are present.</summary>
    public bool Ready => FromEmail.Contains('@') && (Provider == "smtp"
        ? Get("MAIL_SMTP_HOST").Length > 0
        : Get("MAIL_API_KEY").Length > 0);
}
