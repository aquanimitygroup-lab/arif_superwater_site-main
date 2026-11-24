using System.Text;
using System.Text.Json.Nodes;
using MailKit;
using MailKit.Net.Smtp;
using MailKit.Security;
using MimeKit;
using SuperWater.Api.Infrastructure;

namespace SuperWater.Api.Services;

/// <summary>Sends one email through the provider chosen in Admin > Email notifications.</summary>
public static class MailTransport
{
    private static readonly HttpClient Client = new() { Timeout = TimeSpan.FromSeconds(25) };

    public static async Task Send(MailSettings s, string to, string subject, string html, string text)
    {
        if (!s.Ready) throw new InvalidOperationException("Email is not set up yet. Fill in the sender and the provider details first.");
        switch (s.Provider)
        {
            case "smtp": await Smtp(s, to, subject, html, text); break;
            case "resend": await Resend(s, to, subject, html, text); break;
            case "sendgrid": await SendGrid(s, to, subject, html, text); break;
            case "brevo": await Brevo(s, to, subject, html, text); break;
            default: throw new InvalidOperationException("Unknown email provider.");
        }
    }

    private static string ReplyTo(MailSettings s) => s.Get("MAIL_REPLY_TO") is { Length: > 0 } r && r.Contains('@') ? r : "";

    private static async Task Smtp(MailSettings s, string to, string subject, string html, string text)
    {
        var msg = new MimeMessage();
        msg.From.Add(new MailboxAddress(s.FromName, s.FromEmail));
        msg.To.Add(MailboxAddress.Parse(to));
        if (ReplyTo(s) is { Length: > 0 } rt) msg.ReplyTo.Add(MailboxAddress.Parse(rt));
        msg.Subject = subject;
        msg.Body = new BodyBuilder { HtmlBody = html, TextBody = text }.ToMessageBody();

        var port = int.TryParse(s.Get("MAIL_SMTP_PORT"), out var p) && p is > 0 and < 65536 ? p : 587;
        var security = port == 465 ? SecureSocketOptions.SslOnConnect : port == 25 ? SecureSocketOptions.StartTlsWhenAvailable : SecureSocketOptions.StartTls;
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        using var client = new MailKit.Net.Smtp.SmtpClient { Timeout = 25000 };
        await client.ConnectAsync(s.Get("MAIL_SMTP_HOST"), port, security, cts.Token);
        if (s.Get("MAIL_SMTP_USER").Length > 0) await client.AuthenticateAsync(s.Get("MAIL_SMTP_USER"), s.Get("MAIL_SMTP_PASSWORD"), cts.Token);
        await client.SendAsync(msg, cts.Token);
        await client.DisconnectAsync(true, cts.Token);
    }

    private static string Url(MailSettings s, string dflt)
    {
        var u = s.Get("MAIL_API_URL").TrimEnd('/');
        if (u.Length == 0) return dflt;
        if (!u.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("The email API link must start with https://.");
        return u;
    }

    private static async Task Post(string provider, HttpRequestMessage req)
    {
        using var r = await Client.SendAsync(req);
        if (r.IsSuccessStatusCode) return;
        var body = await r.Content.ReadAsStringAsync();
        string? detail = null;
        try { if (JsonNode.Parse(body) is JsonObject o) detail = (o["message"] ?? o["error"] ?? o["errors"]?[0]?["message"] ?? o["code"])?.ToString(); } catch { /* not JSON */ }
        detail ??= body.Length > 200 ? body[..200] : body;
        throw new InvalidOperationException($"{provider} refused the email ({(int)r.StatusCode}): {detail}");
    }

    private static HttpRequestMessage Json(string url, JsonObject body, string headerName, string headerValue)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, url) { Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json") };
        req.Headers.TryAddWithoutValidation(headerName, headerValue);
        return req;
    }

    private static async Task Resend(MailSettings s, string to, string subject, string html, string text)
    {
        var b = new JsonObject
        {
            ["from"] = $"{s.FromName} <{s.FromEmail}>", ["to"] = new JsonArray(to), ["subject"] = subject, ["html"] = html, ["text"] = text,
        };
        if (ReplyTo(s) is { Length: > 0 } rt) b["reply_to"] = rt;
        await Post("Resend", Json(Url(s, "https://api.resend.com/emails"), b, "Authorization", "Bearer " + s.Get("MAIL_API_KEY")));
    }

    private static async Task SendGrid(MailSettings s, string to, string subject, string html, string text)
    {
        var b = new JsonObject
        {
            ["personalizations"] = new JsonArray(new JsonObject { ["to"] = new JsonArray(new JsonObject { ["email"] = to }) }),
            ["from"] = new JsonObject { ["email"] = s.FromEmail, ["name"] = s.FromName },
            ["subject"] = subject,
            ["content"] = new JsonArray(new JsonObject { ["type"] = "text/plain", ["value"] = text }, new JsonObject { ["type"] = "text/html", ["value"] = html }),
        };
        if (ReplyTo(s) is { Length: > 0 } rt) b["reply_to"] = new JsonObject { ["email"] = rt };
        await Post("SendGrid", Json(Url(s, "https://api.sendgrid.com/v3/mail/send"), b, "Authorization", "Bearer " + s.Get("MAIL_API_KEY")));
    }

    private static async Task Brevo(MailSettings s, string to, string subject, string html, string text)
    {
        var b = new JsonObject
        {
            ["sender"] = new JsonObject { ["name"] = s.FromName, ["email"] = s.FromEmail },
            ["to"] = new JsonArray(new JsonObject { ["email"] = to }),
            ["subject"] = subject, ["htmlContent"] = html, ["textContent"] = text,
        };
        if (ReplyTo(s) is { Length: > 0 } rt) b["replyTo"] = new JsonObject { ["email"] = rt };
        await Post("Brevo", Json(Url(s, "https://api.brevo.com/v3/smtp/email"), b, "api-key", s.Get("MAIL_API_KEY")));
    }
}
