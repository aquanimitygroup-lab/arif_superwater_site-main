using System.Globalization;
using System.Net;
using System.Text;
using SuperWater.Api.Models;

namespace SuperWater.Api.Services;

/// <summary>The emails customers (and the shop) receive. Plain table layout with inline styles so every mail app shows it properly.</summary>
public static class EmailTemplates
{
    public sealed record Mail(string Subject, string Html, string Text);

    private const string Navy = "#0E1036", Cyan = "#00B4D3", CyanDeep = "#0093AF", Ice = "#EEF9FD", Ink2 = "#4A5070", Line = "#E3E8EF";

    private static readonly CultureInfo Bd = CultureInfo.GetCultureInfo("en-IN");
    private static string Tk(int n) => "Tk " + n.ToString("N0", Bd);
    private static string E(string? s) => WebUtility.HtmlEncode(s ?? "");

    public static string PayLabel(string method) => method switch
    {
        "cod" => "Cash on delivery",
        "bkash" => "bKash",
        "sslcommerz" => "SSLCommerz (card / mobile banking)",
        _ => string.IsNullOrEmpty(method) ? "" : char.ToUpperInvariant(method[0]) + method[1..],
    };

    private static string PayStatus(Order o) => o.PaymentStatus switch
    {
        "paid" => "Paid", "refunded" => "Refunded", "failed" => "Failed", "pending" => "Waiting for payment",
        _ => o.PaymentMethod == "cod" ? "Pay on delivery" : "Not paid",
    };

    private static int Stage(Order o) => o.Status switch { "pending" => 1, "confirmed" => 2, "dispatched" => 3, "delivered" => 4, _ => 0 };

    private sealed record Copy(string Subject, string Headline, string Lead, bool Track = true);

    private static Copy CopyFor(string kind, Order o) => kind switch
    {
        "placed" => new($"We've received your order {o.Code}", $"Thank you, {First(o)}!",
            "We've received your order. We'll call you shortly to confirm your delivery time. Please keep the cash ready for the delivery."),
        "paid" => new($"Payment received for order {o.Code}", "Payment received",
            "Thank you! Your payment was successful and your order is confirmed. We'll dispatch it soon."),
        "payment_failed" => new($"Payment didn't go through for order {o.Code}", "Your payment didn't go through",
            "The payment was not completed, so this order was cancelled and you have not been charged. You can try again any time from our shop.", Track: false),
        "confirmed" => new($"Your order {o.Code} is confirmed", "Your order is confirmed",
            "Good news! We've confirmed your order and are getting it ready for dispatch."),
        "dispatched" => new($"Your order {o.Code} is on its way", "Your order is on its way",
            "Your order has left our facility and is on its way to you. Please keep your phone nearby."),
        "delivered" => new($"Your order {o.Code} has been delivered", "Delivered. Enjoy!",
            "Your Super Water has been delivered. We hope you enjoy it, and thank you for choosing us."),
        "cancelled" => new($"Your order {o.Code} was cancelled", "Your order was cancelled",
            "This order has been cancelled. If you didn't expect this, please contact us and we'll help."),
        "refunded" => new($"Refund for order {o.Code}", "Your payment was refunded",
            "We've marked your payment as refunded. Depending on your bank or wallet, it can take a few days to show in your account."),
        _ => new($"Update on your order {o.Code}", "Order update", "There is an update on your order."),
    };

    private static string First(Order o) => (o.CustomerName ?? "").Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? "there";

    /// <summary>The email to a customer about their order.</summary>
    public static Mail ForCustomer(string kind, Order o, string site, string footer)
    {
        var c = CopyFor(kind, o);
        var link = c.Track ? $"{site}/order?code={Uri.EscapeDataString(o.Code)}&token={Uri.EscapeDataString(o.PublicToken ?? "")}" : $"{site}/#shop";
        var button = c.Track ? "Track your order" : "Back to the shop";
        var receiptLink = $"{site}/order?code={Uri.EscapeDataString(o.Code)}&token={Uri.EscapeDataString(o.PublicToken ?? "")}&receipt=1";
        var when = o.CreatedAt.ToOffset(TimeSpan.FromHours(6)).ToString("d MMM yyyy, h:mm tt", CultureInfo.InvariantCulture);

        var items = new StringBuilder();
        foreach (var i in o.Items)
            items.Append($"<tr><td style=\"padding:10px 0;border-bottom:1px solid {Line};font-size:15px;color:{Navy}\">{i.Qty} × {E(i.Name)}</td><td align=\"right\" style=\"padding:10px 0;border-bottom:1px solid {Line};font-size:15px;color:{Navy};white-space:nowrap\">{Tk(i.Qty * i.Price)}</td></tr>");
        items.Append($"<tr><td style=\"padding:10px 0;font-size:14px;color:{Ink2}\">Delivery</td><td align=\"right\" style=\"padding:10px 0;font-size:14px;color:{Ink2}\">{(o.DeliveryFee > 0 ? Tk(o.DeliveryFee) : "Free")}</td></tr>");
        items.Append($"<tr><td style=\"padding:12px 14px;background:{Ice};font-size:17px;font-weight:800;color:{Navy};border-radius:10px 0 0 10px\">Total</td><td align=\"right\" style=\"padding:12px 14px;background:{Ice};font-size:17px;font-weight:800;color:{Navy};border-radius:0 10px 10px 0\">{Tk(o.Total)}</td></tr>");

        var progress = "";
        if (Stage(o) > 0)
        {
            var labels = new[] { "Received", "Confirmed", "Dispatched", "Delivered" };
            var sb = new StringBuilder("<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin:22px 0 6px\"><tr>");
            for (var n = 1; n <= 4; n++)
            {
                var on = n <= Stage(o);
                sb.Append($"<td align=\"center\" style=\"font-size:12px;font-weight:700;color:{(on ? Navy : "#98A2B3")}\"><div style=\"height:6px;border-radius:6px;background:{(on ? Cyan : Line)};margin:0 3px 8px\"></div>{labels[n - 1]}</td>");
            }
            sb.Append("</tr></table>");
            progress = sb.ToString();
        }

        var body = $@"
<h1 style=""margin:0 0 10px;font-size:26px;line-height:1.2;color:{Navy}"">{E(c.Headline)}</h1>
<p style=""margin:0 0 6px;font-size:16px;line-height:1.55;color:{Ink2}"">{E(c.Lead)}</p>
{progress}
<p style=""margin:22px 0 2px;font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:{CyanDeep}"">Receipt · Order {E(o.Code)}</p>
<p style=""margin:0 0 6px;font-size:13px;color:{Ink2}"">{E(when)} (Bangladesh time)</p>
<table role=""presentation"" width=""100%"" cellpadding=""0"" cellspacing=""0"">{items}</table>
<table role=""presentation"" width=""100%"" cellpadding=""0"" cellspacing=""0"" style=""margin-top:22px""><tr>
<td valign=""top"" width=""50%"" style=""font-size:14px;line-height:1.55;color:{Navy};padding-right:10px""><div style=""font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:{Ink2};margin-bottom:4px"">Delivery to</div>{E(o.CustomerName)}<br>{E(o.Address)}, {E(o.City)}<br>{E(o.Phone)}</td>
<td valign=""top"" width=""50%"" style=""font-size:14px;line-height:1.55;color:{Navy}""><div style=""font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:{Ink2};margin-bottom:4px"">Payment</div>{E(PayLabel(o.PaymentMethod))}<br>{E(PayStatus(o))}</td>
</tr></table>
<p style=""margin:28px 0 8px""><a href=""{E(link)}"" style=""display:inline-block;background:{Navy};color:#ffffff;text-decoration:none;font-weight:700;font-size:16px;padding:14px 28px;border-radius:999px;margin:0 8px 8px 0"">{button}</a>{(c.Track ? $@"<a href=""{E(receiptLink)}"" style=""display:inline-block;background:#ffffff;color:{Navy};text-decoration:none;font-weight:700;font-size:16px;padding:12px 26px;border-radius:999px;border:2px solid {Navy};margin:0 0 8px 0"">Download receipt</a>" : "")}</p>";

        var text = new StringBuilder();
        text.AppendLine(c.Headline).AppendLine().AppendLine(c.Lead).AppendLine().AppendLine($"Order {o.Code}");
        foreach (var i in o.Items) text.AppendLine($"  {i.Qty} x {i.Name}  {Tk(i.Qty * i.Price)}");
        text.AppendLine($"  Delivery  {(o.DeliveryFee > 0 ? Tk(o.DeliveryFee) : "Free")}").AppendLine($"  Total  {Tk(o.Total)}").AppendLine();
        text.AppendLine($"Delivery to: {o.CustomerName}, {o.Address}, {o.City}, {o.Phone}");
        text.AppendLine($"Payment: {PayLabel(o.PaymentMethod)} ({PayStatus(o)})").AppendLine($"Date: {when} (Bangladesh time)").AppendLine().AppendLine($"{button}: {link}");
        if (c.Track) text.AppendLine($"Download receipt: {receiptLink}");
        if (footer.Length > 0) text.AppendLine().AppendLine(footer);

        return new Mail(c.Subject, Wrap(c.Subject, body, footer), text.ToString());
    }

    /// <summary>A short alert to the shop owner about a new order.</summary>
    public static Mail ForAdmin(Order o, string site)
    {
        var subject = $"New order {o.Code} · {Tk(o.Total)} · {PayLabel(o.PaymentMethod)}";
        var rows = string.Join("", o.Items.Select(i => $"<li style=\"margin:2px 0\">{i.Qty} × {E(i.Name)} <span style=\"color:{Ink2}\">({Tk(i.Qty * i.Price)})</span></li>"));
        var link = $"{site}/admin#orders";
        var body = $@"
<h1 style=""margin:0 0 10px;font-size:24px;color:{Navy}"">New order {E(o.Code)}</h1>
<p style=""margin:0 0 12px;font-size:16px;color:{Ink2}"">{E(o.CustomerName)} · {E(o.Phone)}{(string.IsNullOrEmpty(o.Email) ? "" : " · " + E(o.Email))}</p>
<ul style=""margin:0 0 12px;padding-left:20px;font-size:15px;color:{Navy}"">{rows}</ul>
<p style=""margin:0 0 4px;font-size:15px;color:{Navy}""><b>Total {Tk(o.Total)}</b> · {E(PayLabel(o.PaymentMethod))} ({E(PayStatus(o))})</p>
<p style=""margin:0 0 4px;font-size:14px;color:{Ink2}"">Deliver to: {E(o.Address)}, {E(o.City)}</p>
{(string.IsNullOrEmpty(o.Note) ? "" : $"<p style=\"margin:0 0 4px;font-size:14px;color:{Ink2}\">Note: {E(o.Note)}</p>")}
<p style=""margin:22px 0 8px""><a href=""{E(link)}"" style=""display:inline-block;background:{Navy};color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 24px;border-radius:999px"">Open the admin</a></p>";
        var text = $"New order {o.Code}\n{o.CustomerName} {o.Phone}\n{string.Join("\n", o.Items.Select(i => $"  {i.Qty} x {i.Name}"))}\nTotal {Tk(o.Total)} - {PayLabel(o.PaymentMethod)} ({PayStatus(o)})\nDeliver to: {o.Address}, {o.City}\n{link}";
        return new Mail(subject, Wrap(subject, body, ""), text);
    }

    public static Mail Test(string site)
    {
        const string subject = "Super Water: test email";
        var body = $@"<h1 style=""margin:0 0 10px;font-size:26px;color:{Navy}"">Your email is working</h1>
<p style=""margin:0;font-size:16px;line-height:1.55;color:{Ink2}"">This is a test message from your Super Water admin. Customers will receive order and payment updates like this one.</p>";
        return new Mail(subject, Wrap(subject, body, ""), "Your email is working. This is a test message from your Super Water admin.");
    }

    private static string Wrap(string title, string body, string footer) => $@"<!doctype html>
<html><head><meta charset=""utf-8""><meta name=""viewport"" content=""width=device-width,initial-scale=1""><title>{E(title)}</title></head>
<body style=""margin:0;padding:0;background:#F3F7FA;font-family:'Segoe UI',Helvetica,Arial,sans-serif"">
<table role=""presentation"" width=""100%"" cellpadding=""0"" cellspacing=""0"" style=""background:#F3F7FA""><tr><td align=""center"" style=""padding:28px 14px"">
<table role=""presentation"" width=""560"" cellpadding=""0"" cellspacing=""0"" style=""width:100%;max-width:560px"">
<tr><td style=""background:{Navy};border-radius:18px 18px 0 0;padding:22px 28px""><span style=""font-size:22px;font-weight:900;letter-spacing:-.01em;color:#ffffff"">Super<span style=""color:{Cyan}"">Water</span></span></td></tr>
<tr><td style=""background:#ffffff;padding:28px;border-radius:0 0 18px 18px"">{body}</td></tr>
<tr><td align=""center"" style=""padding:18px 10px;font-size:12.5px;line-height:1.6;color:#7A8296"">{(footer.Length > 0 ? E(footer) + "<br>" : "")}Super Water by Aquanimity</td></tr>
</table></td></tr></table></body></html>";
}
