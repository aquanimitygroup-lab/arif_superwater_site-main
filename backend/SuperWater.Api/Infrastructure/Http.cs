using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace SuperWater.Api.Infrastructure;

/// <summary>Request and response helpers shared by every endpoint (port of lib/http.js).</summary>
public static class Http
{
    public static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        DictionaryKeyPolicy = null,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
    };

    /// <summary>Writes a JSON response. Private data is never cached unless a Cache-Control header is given.</summary>
    public static async Task Send(HttpContext ctx, int status, object? body, IDictionary<string, string>? headers = null)
    {
        var res = ctx.Response;
        res.StatusCode = status;
        res.ContentType = "application/json; charset=utf-8";
        if (headers is null || !headers.ContainsKey("Cache-Control")) res.Headers.CacheControl = "no-store";
        if (headers is not null) foreach (var (k, v) in headers) res.Headers.Append(k, v);
        var json = JsonSerializer.Serialize(body, body?.GetType() ?? typeof(object), JsonOptions);
        await res.WriteAsync(json, Encoding.UTF8);
    }

    public static Task Redirect(HttpContext ctx, string location)
    {
        ctx.Response.StatusCode = 303;
        ctx.Response.Headers.Location = location;
        ctx.Response.Headers.CacheControl = "no-store";
        return Task.CompletedTask;
    }

    /// <summary>Query string as a plain dictionary (last value wins, like Object.fromEntries(searchParams)).</summary>
    public static Dictionary<string, string> Query(HttpContext ctx)
    {
        var d = new Dictionary<string, string>();
        foreach (var (k, v) in ctx.Request.Query) d[k] = v.Count > 0 ? v[v.Count - 1] ?? "" : "";
        return d;
    }

    public static string Q(Dictionary<string, string> q, string key) => q.TryGetValue(key, out var v) ? v : "";

    /// <summary>Reads a JSON or form-encoded body (max 200 KB).</summary>
    public static async Task<JsonObject> Body(HttpContext ctx)
    {
        using var ms = new MemoryStream();
        var buf = new byte[16384];
        int n;
        while ((n = await ctx.Request.Body.ReadAsync(buf)) > 0)
        {
            ms.Write(buf, 0, n);
            if (ms.Length > 200_000) throw new HttpError(413, "Request is too large.");
        }
        var text = Encoding.UTF8.GetString(ms.ToArray());
        return Parse(text, ctx.Request.ContentType ?? "");
    }

    private static JsonObject Parse(string text, string type)
    {
        if (string.IsNullOrEmpty(text)) return new JsonObject();
        if (type.Contains("application/x-www-form-urlencoded"))
        {
            var o = new JsonObject();
            foreach (var (k, v) in Microsoft.AspNetCore.WebUtilities.QueryHelpers.ParseQuery(text))
                o[k] = JsonValue.Create(v.Count > 0 ? v[v.Count - 1] : "");
            return o;
        }
        try
        {
            var node = JsonNode.Parse(text);
            // The original returns whatever JSON was sent; endpoints only ever read properties,
            // so a non-object body behaves like an empty one.
            return node as JsonObject ?? new JsonObject();
        }
        catch (JsonException)
        {
            throw new HttpError(400, "The request body is not valid JSON.");
        }
    }

    public static void Method(HttpContext ctx, params string[] allowed)
    {
        if (!allowed.Contains(ctx.Request.Method)) throw new HttpError(405, $"Use {string.Join(" or ", allowed)} for this request.");
    }

    public static string ClientIp(HttpContext ctx)
    {
        var fwd = ctx.Request.Headers["x-forwarded-for"].ToString();
        var raw = !string.IsNullOrEmpty(fwd) ? fwd : ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        return raw.Split(',')[0].Trim();
    }

    /// <summary>The public address of the site, used for payment return links.</summary>
    public static string SiteUrl(HttpContext ctx, IConfiguration config)
    {
        var configured = config["SITE_URL"];
        if (!string.IsNullOrEmpty(configured)) return configured.TrimEnd('/');
        var proto = ctx.Request.Headers["x-forwarded-proto"].ToString();
        if (string.IsNullOrEmpty(proto)) proto = ctx.Request.Scheme;
        var host = ctx.Request.Headers["x-forwarded-host"].ToString();
        if (string.IsNullOrEmpty(host)) host = ctx.Request.Host.ToString();
        return $"{proto}://{host}";
    }

    // ---------- small validators (same messages as the original) ----------
    public static string Str(JsonObject? o, string key, string name, int max = 200, bool required = false, int min = 0)
    {
        var v = Js.Get(o, key, out var present);
        var s = !present || v is null ? "" : Js.ToStr(v).Trim();
        if (required && s.Length == 0) throw new HttpError(400, $"{name} is required.");
        if (s.Length > max) throw new HttpError(400, $"{name} is too long (maximum {max} characters).");
        if (s.Length > 0 && s.Length < min) throw new HttpError(400, $"{name} is too short.");
        return s;
    }

    public static int Int(double n, string name, double min = double.NegativeInfinity, double max = double.PositiveInfinity)
    {
        if (!Js.IsInteger(n)) throw new HttpError(400, $"{name} must be a whole number.");
        if (n < min || n > max) throw new HttpError(400, $"{name} must be between {Js.Bound(min)} and {Js.Bound(max)}.");
        return (int)n;
    }

    public static int Int(JsonObject? o, string key, string name, double min = double.NegativeInfinity, double max = double.PositiveInfinity)
        => Int(Js.ToNumber(o, key), name, min, max);

    public static int Int(string? queryValue, string name, double min = double.NegativeInfinity, double max = double.PositiveInfinity)
        => Int(queryValue is null ? double.NaN : Js.ParseNumber(queryValue), name, min, max);
}
