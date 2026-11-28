using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.WebUtilities;
using SuperWater.Api.Infrastructure;
using SuperWater.Api.Models;

namespace SuperWater.Api.Services;

/// <summary>Sign-in, sessions and API keys (port of lib/auth.js).</summary>
public sealed class Auth(IConfiguration config, IWebHostEnvironment env, Db db)
{
    private const string Cookie = "sw_session";
    private const int SessionHours = 12;

    public static string HashPassword(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(16);
        var hash = Scrypt.Derive(Encoding.UTF8.GetBytes(password), salt, 64);
        return $"scrypt${Convert.ToBase64String(salt)}${Convert.ToBase64String(hash)}";
    }

    public static bool VerifyPassword(string password, string stored)
    {
        var parts = (stored ?? "").Split('$');
        if (parts.Length < 3 || parts[0] != "scrypt" || parts[1].Length == 0 || parts[2].Length == 0) return false;
        try
        {
            var expected = Convert.FromBase64String(parts[2]);
            var actual = Scrypt.Derive(Encoding.UTF8.GetBytes(password), Convert.FromBase64String(parts[1]), expected.Length);
            return CryptographicOperations.FixedTimeEquals(expected, actual);
        }
        catch (FormatException) { return false; }
    }

    private string Secret()
    {
        var s = config["SESSION_SECRET"];
        if (string.IsNullOrEmpty(s) || s.Length < 32)
            throw new HttpError(503, "SESSION_SECRET is not set (it needs at least 32 characters). Add it to appsettings.json or the server's environment variables.");
        return s;
    }

    private static string B64Url(byte[] b) => WebEncoders.Base64UrlEncode(b);

    private string Sign(JsonObject payload)
    {
        var data = B64Url(Encoding.UTF8.GetBytes(payload.ToJsonString()));
        var mac = B64Url(HMACSHA256.HashData(Encoding.UTF8.GetBytes(Secret()), Encoding.UTF8.GetBytes(data)));
        return $"{data}.{mac}";
    }

    private JsonObject? Unsign(string? token)
    {
        var parts = (token ?? "").Split('.');
        if (parts.Length < 2 || parts[0].Length == 0 || parts[1].Length == 0) return null;
        var (data, mac) = (parts[0], parts[1]);
        var expected = HMACSHA256.HashData(Encoding.UTF8.GetBytes(Secret()), Encoding.UTF8.GetBytes(data));
        byte[] given;
        try { given = WebEncoders.Base64UrlDecode(mac); } catch (FormatException) { return null; }
        if (given.Length != expected.Length || !CryptographicOperations.FixedTimeEquals(given, expected)) return null;
        JsonObject? payload;
        try { payload = JsonNode.Parse(Encoding.UTF8.GetString(WebEncoders.Base64UrlDecode(data))) as JsonObject; }
        catch { return null; }
        if (payload is null) return null;
        var exp = Js.ToNumber(payload, "exp");
        if (!(exp > 0) || exp < DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()) return null;
        return payload;
    }

    private static string Tail(string hash) => hash.Length > 12 ? hash[^12..] : hash;

    public string SessionCookie(int userId, string passwordHash, HttpContext ctx)
    {
        var token = Sign(new JsonObject
        {
            ["uid"] = userId,
            ["v"] = Tail(passwordHash),
            ["exp"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + SessionHours * 3600_000L,
        });
        var secure = UseSecure(ctx) ? "; Secure" : "";
        // Lax (not Strict) so the session survives opening the website from the admin panel in a new tab; writes are still protected by the x-sw-admin header.
        return $"{Cookie}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={SessionHours * 3600}{secure}";
    }

    /// <summary>
    /// Mark cookies Secure only when the visitor really is on HTTPS (directly, through a proxy that says so, or when
    /// the configured SITE_URL is https). A Secure cookie set over plain HTTP is silently dropped by the browser,
    /// which made people look signed out after a reload.
    /// </summary>
    private bool UseSecure(HttpContext ctx) =>
        ctx.Request.IsHttps
        || ctx.Request.Headers["x-forwarded-proto"].ToString().Contains("https")
        || (env.IsProduction() && (config["SITE_URL"] ?? "").StartsWith("https://", StringComparison.OrdinalIgnoreCase));

    public static string ClearCookie() => $"{Cookie}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
    // ---------- website customers (separate cookie, same signing) ----------
    private const string CustomerCookieName = "sw_customer";
    private const int CustomerDays = 30;

    public string CustomerSessionCookie(int id, string passwordHash, HttpContext ctx)
    {
        var token = Sign(new JsonObject
        {
            ["k"] = "customer",
            ["uid"] = id,
            ["v"] = Tail(passwordHash),
            ["exp"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + CustomerDays * 86400_000L,
        });
        var secure = UseSecure(ctx) ? "; Secure" : "";
        return $"{CustomerCookieName}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={CustomerDays * 86400}{secure}";
    }

    public static string ClearCustomerCookie() => $"{CustomerCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";

    /// <summary>The signed-in customer, or null.</summary>
    public async Task<CustomerRow?> CurrentCustomer(HttpContext ctx)
    {
        var payload = Unsign(ctx.Request.Cookies[CustomerCookieName]);
        if (payload is null || Js.ToStr(payload["k"]) != "customer") return null;
        var uid = Js.ToNumber(payload, "uid");
        if (!Js.IsInteger(uid)) return null;
        var c = await db.One<CustomerRow>("SELECT * FROM dbo.customers WHERE id = @id", new { id = (int)uid });
        return c is null || Tail(c.PasswordHash) != Js.ToStr(payload["v"]) ? null : c;
    }

    /// <summary>The signed-in staff/admin user (read-only check, never throws), or null.</summary>
    public async Task<UserRow?> CurrentStaff(HttpContext ctx)
    {
        var payload = Unsign(ctx.Request.Cookies[Cookie]);
        if (payload is null || payload["k"] is not null) return null;
        var uid = Js.ToNumber(payload, "uid");
        if (!Js.IsInteger(uid)) return null;
        var user = await db.One<UserRow>("SELECT id, email, name, role, password_hash, active FROM dbo.users WHERE id = @id", new { id = (int)uid });
        return user is null || !user.Active || Tail(user.PasswordHash) != Js.ToStr(payload["v"]) ? null : user;
    }

    /// <summary>
    /// Returns the signed-in user or throws 401/403.
    /// Changing a password signs out every existing session for that user.
    /// </summary>
    public async Task<SessionUser> RequireUser(HttpContext ctx, params string[] roles)
    {
        if (roles.Length == 0) roles = ["admin"];
        var payload = Unsign(ctx.Request.Cookies[Cookie]);
        if (payload is null) throw new HttpError(401, "Please sign in.");
        var uid = Js.ToNumber(payload, "uid");
        if (payload["k"] is not null || !Js.IsInteger(uid)) throw new HttpError(401, "Your session has ended. Please sign in again.");
        var user = await db.One<UserRow>("SELECT id, email, name, role, password_hash, active FROM dbo.users WHERE id = @id", new { id = (int)uid });
        if (user is null || !user.Active || Tail(user.PasswordHash) != Js.ToStr(payload["v"])) throw new HttpError(401, "Your session has ended. Please sign in again.");
        if (!roles.Contains(user.Role)) throw new HttpError(403, "Your account does not have access to this.");
        // Extra protection against cross-site requests for anything that changes data.
        if (ctx.Request.Method != "GET" && ctx.Request.Headers["x-sw-admin"].ToString() != "1") throw new HttpError(403, "Request blocked.");
        return new SessionUser(user.Id, user.Email, user.Name, user.Role, user.Active) { PasswordHash = user.PasswordHash };
    }

    /// <summary>Allows 10 failed sign-ins per address per 15 minutes. Returns a function that records a failure.</summary>
    public async Task<Func<Task>> CheckLoginRate(HttpContext ctx)
    {
        var ip = Http.ClientIp(ctx);
        await db.Execute("DELETE FROM dbo.login_attempts WHERE at < DATEADD(day, -1, SYSDATETIMEOFFSET())");
        var n = await db.Scalar<int>("SELECT COUNT(*) FROM dbo.login_attempts WHERE ip = @ip AND at > DATEADD(minute, -15, SYSDATETIMEOFFSET())", new { ip });
        if (n >= 10) throw new HttpError(429, "Too many sign-in attempts. Wait 15 minutes and try again.");
        return async () => { await db.Execute("INSERT INTO dbo.login_attempts (ip) VALUES (@ip)", new { ip }); };
    }

    /// <summary>Constant-time check of the production facility's API key.</summary>
    public static void RequireFacilityKey(HttpContext ctx, IConfiguration config)
    {
        var key = config["FACILITY_API_KEY"];
        if (string.IsNullOrEmpty(key) || key.Length < 24) throw new HttpError(503, "FACILITY_API_KEY is not set (it needs at least 24 characters).");
        var given = System.Text.RegularExpressions.Regex.Replace(ctx.Request.Headers.Authorization.ToString(), @"^Bearer\s+", "", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        var a = Encoding.UTF8.GetBytes(given);
        var b = Encoding.UTF8.GetBytes(key);
        if (a.Length != b.Length || !CryptographicOperations.FixedTimeEquals(a, b)) throw new HttpError(401, "Invalid or missing facility API key.");
    }
}
