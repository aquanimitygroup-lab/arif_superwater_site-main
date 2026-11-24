using System.Text.Json.Nodes;

namespace SuperWater.Api.Infrastructure;

/// <summary>One setting the admin can edit.</summary>
public sealed record SettingField(string Key, string Label, bool Secret, string Hint, string Placeholder = "");

/// <summary>
/// Settings the admin edits in the admin panel (payment keys, email API…). They are stored in the database and win over
/// appsettings.json / environment variables, so they can be changed without touching the server. Reads come from a small
/// cache that is refreshed from the database every few seconds, so code that needs a value can read it synchronously.
/// </summary>
public abstract class AdminSettings(IConfiguration config, string stateKey)
{
    private volatile Dictionary<string, string> _saved = new();
    private long _loadedAt = long.MinValue / 2;

    /// <summary>Admin-saved value if there is one, otherwise the server setting.</summary>
    public string Get(string key) => _saved.TryGetValue(key, out var v) ? v : (config[key] ?? "").Trim();

    /// <summary>True for "true", false for "false", otherwise the default.</summary>
    public bool Flag(string key, bool dflt) => Get(key) switch { "true" => true, "false" => false, _ => dflt };

    /// <summary>Whether a value comes from the admin page (true) or the server settings (false).</summary>
    public bool IsSaved(string key) => _saved.ContainsKey(key);

    public async Task Refresh(Db db, bool force = false)
    {
        if (!force && Environment.TickCount64 - Interlocked.Read(ref _loadedAt) < 5000) return;
        _saved = await ReadSaved(db);
        Interlocked.Exchange(ref _loadedAt, Environment.TickCount64);
    }

    private async Task<Dictionary<string, string>> ReadSaved(Db db)
    {
        var text = await db.One<string>("SELECT value FROM dbo.app_state WHERE [key] = @k", new { k = stateKey });
        var map = new Dictionary<string, string>();
        if (text is not null && JsonNode.Parse(text) is JsonObject o)
            foreach (var (k, v) in o) if (v is not null) map[k] = Js.ToStr(v);
        return map;
    }

    /// <summary>Merges changes into the saved settings (an empty string saves an empty value).</summary>
    public async Task Save(Db db, Dictionary<string, string> changes)
    {
        var map = await ReadSaved(db);
        foreach (var (k, v) in changes) map[k] = v;
        var obj = new JsonObject();
        foreach (var (k, v) in map) obj[k] = v;
        var json = obj.ToJsonString();
        var n = await db.Execute("UPDATE dbo.app_state SET value = @json, updated_at = SYSDATETIMEOFFSET() WHERE [key] = @k", new { json, k = stateKey });
        if (n == 0)
        {
            try { await db.Execute("INSERT INTO dbo.app_state ([key], value) VALUES (@k, @json)", new { json, k = stateKey }); }
            catch (Exception e) when (Db.IsUniqueViolation(e))
            {
                await db.Execute("UPDATE dbo.app_state SET value = @json, updated_at = SYSDATETIMEOFFSET() WHERE [key] = @k", new { json, k = stateKey });
            }
        }
        _saved = map;
        Interlocked.Exchange(ref _loadedAt, Environment.TickCount64);
    }
}
