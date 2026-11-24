using Microsoft.Extensions.FileProviders;
using SuperWater.Api.Endpoints;
using SuperWater.Api.Infrastructure;
using SuperWater.Api.Payments;
using SuperWater.Api.Services;

// Super Water: website API, admin API, payment returns and the facility API.
// In production this app also serves the built React site from wwwroot
// (run `npm run build` in ../../frontend first).

var builder = WebApplication.CreateBuilder(args);

DapperSetup.Configure();

builder.Services.AddSingleton<Schema>();
builder.Services.AddScoped<Db>();
builder.Services.AddScoped<Auth>();
builder.Services.AddSingleton<MailSettings>();
builder.Services.AddSingleton<SiteUrlHolder>();
builder.Services.AddSingleton<OrderMailer>();
builder.Services.AddScoped<Orders>();
builder.Services.AddSingleton<PaymentSettings>();
builder.Services.AddSingleton<IPaymentGateway, SslCommerzGateway>();
builder.Services.AddSingleton<IPaymentGateway, BkashGateway>();
// To add another gateway, see Payments/TemplateGateway.cs, then register it here.
builder.Services.AddSingleton<Gateways>();

var app = builder.Build();

// Remember the public address of the site, so links in emails point to the right place.
var siteUrlHolder = app.Services.GetRequiredService<SiteUrlHolder>();
app.Use(async (ctx, next) =>
{
    if (string.IsNullOrEmpty(app.Configuration["SITE_URL"])) siteUrlHolder.Value = Http.SiteUrl(ctx, app.Configuration);
    await next();
});

// ---------- headers (same rules as the original vercel.json) ----------
app.Use(async (ctx, next) =>
{
    var path = ctx.Request.Path.Value ?? "/";
    ctx.Response.OnStarting(() =>
    {
        var h = ctx.Response.Headers;
        h["X-Content-Type-Options"] = "nosniff";
        h["Referrer-Policy"] = "strict-origin-when-cross-origin";
        h["X-Frame-Options"] = "SAMEORIGIN";
        if (path.StartsWith("/assets/", StringComparison.Ordinal))
            h.CacheControl = "public, max-age=604800, stale-while-revalidate=86400";
        else if (path.StartsWith("/admin", StringComparison.Ordinal))
        {
            h["X-Robots-Tag"] = "noindex, nofollow";
            h.CacheControl = "no-store";
        }
        else if (!path.StartsWith("/api/", StringComparison.Ordinal) && string.IsNullOrEmpty(h.CacheControl))
            h.CacheControl = "public, max-age=0, must-revalidate";
        return Task.CompletedTask;
    });
    await next();
});

// ---------- API ----------
app.Map("/api/site", b => b.Run(Handler.Wrap(SiteEndpoint.Handle)));
app.Map("/api/admin", b => b.Run(Handler.Wrap(AdminEndpoint.Handle)));
app.Map("/api/payment", b => b.Run(Handler.Wrap(PaymentEndpoint.Handle)));
app.Map("/api/facility", b => b.Run(Handler.Wrap(FacilityEndpoint.Handle)));
app.Map("/api", b => b.Run(Handler.Wrap(_ => throw new HttpError(404, "Unknown request."))));

// ---------- the React site (clean URLs, no trailing slashes) ----------
var web = app.Environment.WebRootPath ?? Path.Combine(app.Environment.ContentRootPath, "wwwroot");
if (Directory.Exists(web))
{
    var files = new PhysicalFileProvider(web);
    app.Use(async (ctx, next) =>
    {
        var path = ctx.Request.Path.Value ?? "/";
        if (path.Length > 1 && path.EndsWith('/'))
        {
            ctx.Response.Redirect(path.TrimEnd('/') + ctx.Request.QueryString, permanent: true);
            return;
        }
        if (path.EndsWith(".html", StringComparison.Ordinal) && path != "/404.html")
        {
            var clean = path[..^5];
            if (clean.EndsWith("/index")) clean = clean[..^6];
            ctx.Response.Redirect((clean.Length == 0 ? "/" : clean) + ctx.Request.QueryString, permanent: true);
            return;
        }
        if (path == "/") ctx.Request.Path = "/index.html";
        else if (!Path.HasExtension(path))
        {
            if (files.GetFileInfo(path + ".html").Exists) ctx.Request.Path = path + ".html";
            else if (files.GetFileInfo(path + "/index.html").Exists) ctx.Request.Path = path + "/index.html";
        }
        await next();
    });
    app.UseStaticFiles(new StaticFileOptions { FileProvider = files });
    app.Run(async ctx =>
    {
        ctx.Response.StatusCode = 404;
        var notFound = files.GetFileInfo("404.html");
        if (notFound.Exists)
        {
            ctx.Response.ContentType = "text/html; charset=utf-8";
            await ctx.Response.SendFileAsync(notFound);
        }
    });
}

app.Run();
