using SuperWater.Api.Infrastructure;
using SuperWater.Api.Models;

namespace SuperWater.Api.Services;

/// <summary>The public address of the site as last seen on a request (used for links in emails when SITE_URL is not set).</summary>
public sealed class SiteUrlHolder { public volatile string Value = ""; }

/// <summary>
/// Emails customers about their order (placed, payment, confirmed, dispatched, delivered, cancelled, refunded)
/// and alerts the shop about new orders. Sending runs in the background, so a slow or broken email service
/// can never delay or break an order. Every attempt is written to the email log shown in the admin.
/// </summary>
public sealed class OrderMailer(IServiceScopeFactory scopes, MailSettings settings, SiteUrlHolder siteHolder, IConfiguration config, ILogger<OrderMailer> log)
{
    /// <summary>Which admin switch controls each kind of customer email.</summary>
    private static readonly Dictionary<string, string> Gate = new()
    {
        ["placed"] = "MAIL_ON_PLACED",
        ["paid"] = "MAIL_ON_PAYMENT", ["payment_failed"] = "MAIL_ON_PAYMENT", ["refunded"] = "MAIL_ON_PAYMENT",
        ["confirmed"] = "MAIL_ON_STATUS", ["dispatched"] = "MAIL_ON_STATUS", ["delivered"] = "MAIL_ON_STATUS", ["cancelled"] = "MAIL_ON_STATUS",
    };

    private string Site => config["SITE_URL"] is { Length: > 0 } s ? s.TrimEnd('/') : siteHolder.Value.TrimEnd('/');

    /// <summary>Queue the email for this order event. Returns immediately.</summary>
    public void Notify(string kind, Order order)
    {
        var site = Site;
        _ = Task.Run(async () =>
        {
            try { await Run(kind, order, site); }
            catch (Exception e) { log.LogWarning(e, "Email for order {Code} ({Kind}) failed", order.Code, kind); }
        });
    }

    private async Task Run(string kind, Order order, string site)
    {
        // An async scope: the database connection is closed properly (a plain scope cannot dispose it).
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Db>();
        await settings.Refresh(db);
        if (!settings.Enabled || !settings.Ready) return;

        // The customer comes first.
        if (!Gate.TryGetValue(kind, out var gate) || !settings.Flag(gate, true))
        {
            await Record(db, order.Code, kind, "-", CopySubject(kind, order, site), "skipped", "This kind of email is switched off in Admin > Email notifications.");
        }
        else
        {
            var to = (order.Email ?? "").Trim();
            if (to.Length == 0 && order.CustomerId is { } cid)
                to = (await db.One<string>("SELECT email FROM dbo.customers WHERE id = @cid", new { cid }) ?? "").Trim();
            if (!to.Contains('@'))
                await Record(db, order.Code, kind, "(no email address)", CopySubject(kind, order, site), "skipped", "This order has no email address (the customer left it empty and is not signed in).");
            else
                await SendLogged(db, order.Code, kind, to, EmailTemplates.ForCustomer(kind, order, site, settings.Get("MAIL_FOOTER")));
        }

        // A new order alert for the shop: cash orders when placed, online orders once they are paid.
        var adminTo = settings.Get("MAIL_ADMIN_EMAIL");
        if (adminTo.Contains('@') && (kind == "placed" || kind == "paid"))
            await SendLogged(db, order.Code, "admin_alert", adminTo, EmailTemplates.ForAdmin(order, site));
    }

    private static string CopySubject(string kind, Order order, string site) => EmailTemplates.ForCustomer(kind, order, site, "").Subject;

    private async Task SendLogged(Db db, string? code, string kind, string to, EmailTemplates.Mail mail)
    {
        Exception? last = null;
        for (var attempt = 1; attempt <= 2; attempt++)
        {
            try
            {
                await MailTransport.Send(settings, to, mail.Subject, mail.Html, mail.Text);
                await Record(db, code, kind, to, mail.Subject, "sent", null);
                return;
            }
            catch (Exception e)
            {
                last = e;
                log.LogWarning(e, "Could not send {Kind} email for {Code} (attempt {Attempt})", kind, code, attempt);
                if (attempt == 1) await Task.Delay(2500); // one retry for a temporary problem
            }
        }
        await Record(db, code, kind, to, mail.Subject, "failed", last?.Message);
    }

    public static async Task Record(Db db, string? code, string kind, string to, string subject, string status, string? error)
    {
        try
        {
            await db.Execute("INSERT INTO dbo.email_log (order_code, kind, to_email, subject, status, error) VALUES (@code, @kind, @to, @subject, @status, @error)",
                new { code, kind, to = Cut(to, 254), subject = Cut(subject, 300), status, error = error is null ? null : Cut(error, 900) });
            await db.Execute("DELETE FROM dbo.email_log WHERE created_at < DATEADD(day, -60, SYSDATETIMEOFFSET())");
        }
        catch { /* logging must never break anything */ }
    }

    private static string Cut(string s, int n) => s.Length > n ? s[..n] : s;

    /// <summary>The "send a test email" button in the admin.</summary>
    public async Task<(bool Ok, string Message)> SendTest(Db db, string to)
    {
        await settings.Refresh(db, force: true);
        if (!settings.Ready) return (false, "Email is not set up yet. Fill in the sender email and the provider details, save, then test again.");
        var mail = EmailTemplates.Test(Site);
        try
        {
            await MailTransport.Send(settings, to, mail.Subject, mail.Html, mail.Text);
            await Record(db, null, "test", to, mail.Subject, "sent", null);
            return (true, $"Test email sent to {to}. Check the inbox (and spam folder).");
        }
        catch (Exception e)
        {
            await Record(db, null, "test", to, mail.Subject, "failed", e.Message);
            return (false, e.Message);
        }
    }
}
