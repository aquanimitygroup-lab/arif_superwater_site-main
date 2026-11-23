using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using SuperWater.Api.Infrastructure;

namespace SuperWater.Api.Services;

public sealed record CmsField(string Key, string Label, string Type,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Help = null);

public sealed record CmsGroup(string Id, string Title, List<CmsField> Fields,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Note = null);

/// <summary>
/// Everything editable from Admin → Website content (port of lib/cms-schema.js).
/// Each field's key matches what the React site reads with t("key").
/// type: text (one line), long (paragraph), lines (one item per line), number, bool
/// </summary>
public static class CmsSchema
{
    private static CmsField F(string key, string label, string type = "text", string? help = null) => new(key, label, type, help);

    private static readonly (string Sku, string Name)[] Skus =
    [
        ("single-500", "Single 500 mL"), ("day-500", "Day Pack (4 × 500 mL)"), ("case-500", "Case of 24 × 500 mL"),
        ("single-2000", "Single 2 L"), ("case-2000", "Case of 6 × 2 L"), ("case5-2000", "5 cases (30 × 2 L)"),
    ];

    private static IEnumerable<CmsField> Each(IEnumerable<int> ns, Func<int, IEnumerable<CmsField>> f) => ns.SelectMany(f);

    public static readonly List<CmsGroup> Groups =
    [
        new("announce", "Announcement bar", [
            F("announce.enabled", "Show the announcement bar", "bool"),
            F("announce.text", "Announcement text"),
        ], "A thin bar above the menu, for news such as free delivery."),
        new("hero", "Top of the page (hero)", [
            F("hero.eyebrow", "Small label above the title"),
            F("hero.tagline1", "Tagline, first part"),
            F("hero.tagline2", "Tagline, second part (in blue italics)"),
            F("hero.lede", "Introduction", "long"),
            F("hero.cta_shop", "Shop button"),
            F("hero.cta_science", "Science button"),
            F("hero.sale_show", "Show the sale price tag", "bool"),
            F("hero.sale_badge", "Sale tag label"),
            F("hero.sale_text", "Sale tag text"),
            F("hero.sale_was", "Sale tag crossed-out price"),
            F("hero.fact1_value", "Fact card 1: big text"),
            F("hero.fact1_label", "Fact card 1: small text"),
            F("hero.fact2_value", "Fact card 2: big text"),
            F("hero.fact2_label", "Fact card 2: small text"),
        ]),
        new("marquee", "Scrolling benefits strip", [
            F("marquee.items", "Items, one per line", "lines"),
        ]),
        new("ing", "What's inside (benefits)", [
            F("ing.eyebrow", "Section label"),
            F("ing.title1", "Title, first part"),
            F("ing.title2", "Title, second part (in blue italics)"),
            F("ing.lede", "Introduction", "long"),
            ..Each([1, 2, 3, 4], n => [
                F($"ing.c{n}.title", $"Card {n}: benefit"),
                F($"ing.c{n}.pill", $"Card {n}: mineral label"),
                F($"ing.c{n}.text", $"Card {n}: description", "long"),
                F($"ing.c{n}.bn", $"Card {n}: Bangla line"),
            ]),
        ]),
        new("sci", "The science", [
            F("sci.eyebrow", "Section label"),
            F("sci.title", "Title"),
            F("sci.lede", "Introduction", "long"),
            ..Each([1, 2], n => [
                F($"sci.c{n}.role", $"Partner {n}: role"),
                F($"sci.c{n}.title", $"Partner {n}: name"),
                F($"sci.c{n}.text", $"Partner {n}: description", "long"),
            ]),
            F("sci.also", "Line under the partner cards"),
            ..Each([1, 2, 3], n => [
                F($"sci.s{n}.title", $"Timeline step {n}: title"),
                F($"sci.s{n}.text", $"Timeline step {n}: text"),
                F($"sci.s{n}.tag", $"Timeline step {n}: status"),
            ]),
        ]),
        new("pre", "Preclinical studies", [
            F("pre.eyebrow", "Label"),
            F("pre.title", "Title"),
            F("pre.text", "Text", "long"),
            F("pre.stat1.value", "Figure 1: number"), F("pre.stat1.label", "Figure 1: label"),
            F("pre.stat2.value", "Figure 2: number"), F("pre.stat2.label", "Figure 2: label"),
        ]),
        new("trial", "Clinical trial", [
            F("trial.eyebrow", "Label"),
            F("trial.badge", "Review badge"),
            F("trial.title", "Title"),
            F("trial.big", "Headline number"),
            F("trial.unit", "Headline unit"),
            F("trial.vs", "Headline comparison"),
            F("trial.big_label", "What the headline measures"),
            F("trial.pct", "Percentage badge"),
            F("trial.fine", "Footnote", "long"),
            ..Each([1, 2, 3], n => [
                F($"trial.st{n}.value", $"Study fact {n}: number"),
                F($"trial.st{n}.label", $"Study fact {n}: label"),
                F($"trial.st{n}.small", $"Study fact {n}: detail"),
            ]),
            F("trial.chart_title", "Chart title"),
            F("trial.chart_sub", "Chart subtitle"),
            F("trial.chart_fine", "Chart footnote"),
            F("more.title", "More results: heading"),
            ..Each([1, 2, 3, 4, 5], n => [
                F($"more.{n}.value", $"Result {n}: number"),
                F($"more.{n}.unit", $"Result {n}: unit"),
                F($"more.{n}.label", $"Result {n}: measure"),
                F($"more.{n}.small", $"Result {n}: detail"),
            ]),
            F("ctx.title", "About the study: heading"),
            F("ctx.text", "About the study: text", "long"),
            F("disclaimer", "Disclaimer", "long"),
        ], "The chart itself is drawn from fixed numbers; ask a developer to change it."),
        new("shop", "Shop section", [
            F("shop.eyebrow", "Section label"),
            F("shop.title", "Title"),
            F("shop.lede", "Introduction", "long"),
            F("shop.trust1", "Note under the cards 1"),
            F("shop.trust2", "Note under the cards 2"),
            F("shop.trust3", "Note under the cards 3"),
        ]),
        new("plans", "Shop cards", Skus.SelectMany(s => new[]
        {
            F($"plans.{s.Sku}.title", $"{s.Name}: title"),
            F($"plans.{s.Sku}.sub", $"{s.Name}: description"),
            F($"plans.{s.Sku}.badge", $"{s.Name}: badge (leave empty for none)"),
            F($"plans.{s.Sku}.bullet1", $"{s.Name}: point 1"),
            F($"plans.{s.Sku}.bullet2", $"{s.Name}: point 2"),
            F($"plans.{s.Sku}.button", $"{s.Name}: button"),
        }).ToList(), "Prices are edited under Products & prices."),
        new("footer", "Footer", [
            F("footer.headline1", "Headline, first part"),
            F("footer.headline2", "Headline, second part"),
            F("footer.copyright", "Copyright line"),
        ]),
        new("order", "Ordering", [
            F("order.delivery_fee", "Delivery charge (Tk)", "number"),
            F("order.free_over", "Free delivery for orders of at least (Tk, 0 = never free)", "number"),
            F("order.cod_enabled", "Accept cash on delivery", "bool"),
            F("order.online_enabled", "Accept online payment (only works once a gateway is connected)", "bool"),
            F("order.areas", "Delivery areas offered at checkout, one per line (leave empty to let customers type their city)", "lines"),
            F("order.thanks", "Message after a cash-on-delivery order", "long"),
        ], "These settings control checkout."),
    ];

    public static readonly Dictionary<string, CmsField> Fields = Groups.SelectMany(g => g.Fields).ToDictionary(f => f.Key);
}

/// <summary>Website text: built-in defaults plus changes saved in the admin (port of lib/content.js).</summary>
public static class Content
{
    /// <summary>The text the site shows out of the box (shared/cms-defaults.json, also used by the React site).</summary>
    public static readonly JsonObject Defaults = LoadDefaults();

    private static JsonObject LoadDefaults()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "cms-defaults.json");
        return (JsonObject)JsonNode.Parse(File.ReadAllText(path))!;
    }

    public static JsonNode? Default(string key) => Defaults.TryGetPropertyValue(key, out var v) ? v : null;

    /// <summary>Only the values someone has changed in the admin.</summary>
    public static async Task<JsonObject> Overrides(Db db)
    {
        var rows = await db.Query<(string Key, string Value)>("SELECT [key], value FROM dbo.content");
        var o = new JsonObject();
        foreach (var (key, value) in rows)
            if (CmsSchema.Fields.ContainsKey(key)) o[key] = JsonNode.Parse(value);
        return o;
    }

    /// <summary>Defaults merged with saved changes.</summary>
    public static async Task<JsonObject> All(Db db)
    {
        var merged = (JsonObject)Defaults.DeepClone();
        foreach (var (k, v) in await Overrides(db)) merged[k] = v?.DeepClone();
        return merged;
    }

    public static JsonNode CleanValue(string key, JsonNode? value)
    {
        if (!CmsSchema.Fields.TryGetValue(key, out var field)) throw new HttpError(400, $"Unknown content field: {key}");
        switch (field.Type)
        {
            case "bool":
                return JsonValue.Create(Js.IsTrueOrTrueString(value));
            case "number":
            {
                var n = Js.ToNumber(value);
                if (double.IsNaN(n) || double.IsInfinity(n) || n < 0 || n > 1_000_000) throw new HttpError(400, $"{field.Label} must be a number, 0 or more.");
                return JsonValue.Create((long)Math.Floor(n + 0.5)); // Math.round
            }
            case "lines":
            {
                var s = value is null ? "" : Js.ToStr(value);
                var lines = s.Split('\n').Select(x => x.Trim()).Where(x => x.Length > 0).Take(40);
                return JsonValue.Create(string.Join("\n", lines));
            }
            default:
            {
                var s = (value is null ? "" : Js.ToStr(value)).Trim();
                if (s.Length > 2000) throw new HttpError(400, $"{field.Label} is too long (maximum 2000 characters).");
                return JsonValue.Create(s);
            }
        }
    }

    /// <summary>JSON text of a value, used to compare against the default (JS: JSON.stringify(a) === JSON.stringify(b)).</summary>
    public static string Json(JsonNode? v) => v is null ? "undefined" : v.ToJsonString(Http.JsonOptions);

    public static bool Bool(JsonObject c, string key) => c[key] is JsonValue v && Js.El(v) is var e
        && e.ValueKind switch { JsonValueKind.True => true, JsonValueKind.Number => e.GetDouble() != 0, JsonValueKind.String => e.GetString()!.Length > 0, _ => false };

    public static int Number(JsonObject c, string key)
    {
        var n = Js.ToNumber(c[key]);
        return double.IsNaN(n) ? 0 : (int)n;
    }

    public static string Text(JsonObject c, string key) => c[key] is null ? "" : Js.ToStr(c[key]);
}
