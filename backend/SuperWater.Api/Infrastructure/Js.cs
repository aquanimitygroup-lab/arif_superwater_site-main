using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace SuperWater.Api.Infrastructure;

/// <summary>
/// Reads values from request bodies the same way the original JavaScript did
/// (String(v), Number(v), Boolean(v)), so validation behaves identically.
/// A missing property is "undefined"; a JSON null is "null".
/// </summary>
public static class Js
{
    /// <summary>A JSON value as a JsonElement, whether it was parsed from text or created in code.</summary>
    public static JsonElement El(JsonValue v)
        => v.TryGetValue<JsonElement>(out var el) ? el : JsonSerializer.Deserialize<JsonElement>(v.ToJsonString());

    public static JsonNode? Get(JsonObject? o, string key, out bool present)
    {
        present = o is not null && o.ContainsKey(key);
        return present ? o![key] : null;
    }

    public static JsonNode? Get(JsonObject? o, string key) => Get(o, key, out _);

    /// <summary>JavaScript truthiness of a body property.</summary>
    public static bool Truthy(JsonObject? o, string key)
    {
        var v = Get(o, key, out var present);
        if (!present || v is null) return false;
        if (v is JsonValue jv)
        {
            var el = El(jv);
            return el.ValueKind switch
            {
                JsonValueKind.True => true,
                JsonValueKind.False => false,
                JsonValueKind.Number => el.GetDouble() is var d && d != 0 && !double.IsNaN(d),
                JsonValueKind.String => el.GetString()!.Length > 0,
                _ => false,
            };
        }
        return true; // objects and arrays are truthy
    }

    /// <summary>true only when the property is the literal false (JS: v === false).</summary>
    public static bool IsFalse(JsonObject? o, string key)
    {
        var v = Get(o, key);
        return v is JsonValue jv && El(jv).ValueKind == JsonValueKind.False;
    }

    /// <summary>true when the property is the literal true or the string "true".</summary>
    public static bool IsTrueOrTrueString(JsonNode? v)
    {
        if (v is not JsonValue jv) return false;
        var el = El(jv);
        return el.ValueKind == JsonValueKind.True || (el.ValueKind == JsonValueKind.String && el.GetString() == "true");
    }

    /// <summary>JavaScript String(v). undefined → "undefined" is never wanted here, so callers use OrEmpty.</summary>
    public static string ToStr(JsonNode? v)
    {
        if (v is null) return "null";
        if (v is JsonArray arr) return string.Join(",", arr.Select(x => x is null ? "" : ToStr(x)));
        if (v is JsonObject) return "[object Object]";
        var el = El((JsonValue)v);
        return el.ValueKind switch
        {
            JsonValueKind.String => el.GetString()!,
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            JsonValueKind.Number => NumberToString(el.GetDouble()),
            _ => "",
        };
    }

    /// <summary>JavaScript String(v || '').</summary>
    public static string OrEmpty(JsonObject? o, string key) => Truthy(o, key) ? ToStr(Get(o, key)) : "";

    /// <summary>JavaScript Number(v).</summary>
    public static double ToNumber(JsonObject? o, string key)
    {
        var v = Get(o, key, out var present);
        if (!present) return double.NaN;
        return ToNumber(v);
    }

    public static double ToNumber(JsonNode? v)
    {
        if (v is null) return 0;
        if (v is JsonArray a) return a.Count == 0 ? 0 : a.Count == 1 ? ToNumber(a[0]) : double.NaN;
        if (v is JsonObject) return double.NaN;
        var el = El((JsonValue)v);
        return el.ValueKind switch
        {
            JsonValueKind.Number => el.GetDouble(),
            JsonValueKind.True => 1,
            JsonValueKind.False => 0,
            JsonValueKind.String => ParseNumber(el.GetString()!),
            _ => double.NaN,
        };
    }

    public static double ParseNumber(string s)
    {
        s = s.Trim();
        if (s.Length == 0) return 0;
        if (s == "Infinity" || s == "+Infinity") return double.PositiveInfinity;
        if (s == "-Infinity") return double.NegativeInfinity;
        if (s.StartsWith("0x", StringComparison.OrdinalIgnoreCase) && long.TryParse(s[2..], NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var hex)) return hex;
        return double.TryParse(s, NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint | NumberStyles.AllowExponent, CultureInfo.InvariantCulture, out var d) ? d : double.NaN;
    }

    public static bool IsInteger(double n) => !double.IsNaN(n) && !double.IsInfinity(n) && Math.Floor(n) == n;

    public static string NumberToString(double d)
    {
        if (double.IsNaN(d)) return "NaN";
        if (double.IsPositiveInfinity(d)) return "Infinity";
        if (double.IsNegativeInfinity(d)) return "-Infinity";
        return d.ToString("R", CultureInfo.InvariantCulture);
    }

    /// <summary>Formats a validator bound the way JavaScript prints it (Infinity, 1000000…).</summary>
    public static string Bound(double d) => NumberToString(d);
}
