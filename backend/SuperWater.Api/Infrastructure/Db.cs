using System.Data;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Dapper;
using Microsoft.Data.SqlClient;
using SuperWater.Api.Models;

namespace SuperWater.Api.Infrastructure;

/// <summary>
/// One SQL Server connection per request (port of lib/db.js). Use <see cref="Begin{T}"/>
/// for work that must succeed or fail together; queries made through the
/// transaction object run inside that transaction.
/// </summary>
public sealed class Db(IConfiguration config) : IAsyncDisposable
{
    private SqlConnection? _conn;

    public static string? ConnectionString(IConfiguration config)
    {
        var cs = config.GetConnectionString("SuperWater");
        if (string.IsNullOrWhiteSpace(cs)) cs = config["DATABASE_URL"];
        return string.IsNullOrWhiteSpace(cs) ? null : cs.Trim();
    }

    private async Task<SqlConnection> Conn()
    {
        if (_conn is not null) return _conn;
        var cs = ConnectionString(config)
            ?? throw new HttpError(503, "The database is not connected yet. Set ConnectionStrings:SuperWater in appsettings.json (or the ConnectionStrings__SuperWater environment variable).");
        var c = new SqlConnection(cs);
        await c.OpenAsync();
        _conn = c;
        return c;
    }

    public async Task<List<T>> Query<T>(string sql, object? args = null)
        => (await (await Conn()).QueryAsync<T>(sql, args)).AsList();

    public async Task<T?> One<T>(string sql, object? args = null)
        => await (await Conn()).QueryFirstOrDefaultAsync<T>(sql, args);

    public async Task<int> Execute(string sql, object? args = null)
        => await (await Conn()).ExecuteAsync(sql, args);

    public async Task<T?> Scalar<T>(string sql, object? args = null)
        => await (await Conn()).ExecuteScalarAsync<T>(sql, args);

    /// <summary>Rows as dictionaries keyed by column name, for ad-hoc result shapes.</summary>
    public async Task<List<Dictionary<string, object?>>> Rows(string sql, object? args = null)
        => (await (await Conn()).QueryAsync(sql, args)).Select(r => new Dictionary<string, object?>((IDictionary<string, object?>)r)).ToList();

    /// <summary>Runs fn in a transaction: commits when it returns, rolls back when it throws.</summary>
    public async Task<T> Begin<T>(Func<Tx, Task<T>> fn)
    {
        var c = await Conn();
        await using var tran = (SqlTransaction)await c.BeginTransactionAsync(IsolationLevel.ReadCommitted);
        try
        {
            var result = await fn(new Tx(c, tran));
            await tran.CommitAsync();
            return result;
        }
        catch
        {
            try { await tran.RollbackAsync(); } catch { /* connection may already have rolled back */ }
            throw;
        }
    }

    public Task Begin(Func<Tx, Task> fn) => Begin<bool>(async tx => { await fn(tx); return true; });

    public async ValueTask DisposeAsync()
    {
        if (_conn is not null) await _conn.DisposeAsync();
    }

    public static bool IsUniqueViolation(Exception e) => e is SqlException s && (s.Number == 2627 || s.Number == 2601);
}

/// <summary>A connection with an open transaction.</summary>
public sealed class Tx(SqlConnection conn, SqlTransaction tran)
{
    public async Task<List<T>> Query<T>(string sql, object? args = null) => (await conn.QueryAsync<T>(sql, args, tran)).AsList();
    public Task<T?> One<T>(string sql, object? args = null) => conn.QueryFirstOrDefaultAsync<T>(sql, args, tran);
    public Task<int> Execute(string sql, object? args = null) => conn.ExecuteAsync(sql, args, tran);
}

/// <summary>Creates the database, tables and starting data on first use, so a fresh server works without a manual step.</summary>
public sealed class Schema(IConfiguration config, ILogger<Schema> log)
{
    private Task? _ready;
    private readonly object _lock = new();

    public async Task Ensure()
    {
        Task t;
        lock (_lock) t = _ready ??= Run();
        try { await t; }
        catch
        {
            lock (_lock) if (ReferenceEquals(_ready, t)) _ready = null; // try again on the next request
            throw;
        }
    }

    private async Task Run()
    {
        var cs = Db.ConnectionString(config)
            ?? throw new HttpError(503, "The database is not connected yet. Set ConnectionStrings:SuperWater in appsettings.json (or the ConnectionStrings__SuperWater environment variable).");
        await CreateDatabaseIfMissing(cs);
        await using var c = new SqlConnection(cs);
        await c.OpenAsync();
        var ddl = await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory, "Database", "schema.sql"));
        foreach (var batch in Regex.Split(ddl, @"^\s*GO\s*$", RegexOptions.Multiline | RegexOptions.IgnoreCase))
        {
            if (string.IsNullOrWhiteSpace(batch)) continue;
            await c.ExecuteAsync(batch);
        }
        await Seed.Defaults(c, config);
    }

    /// <summary>If the database named in the connection string does not exist yet, create it.</summary>
    private async Task CreateDatabaseIfMissing(string cs)
    {
        var b = new SqlConnectionStringBuilder(cs);
        var name = b.InitialCatalog;
        if (string.IsNullOrEmpty(name) || name.Equals("master", StringComparison.OrdinalIgnoreCase)) return;
        b.InitialCatalog = "master";
        try
        {
            await using var m = new SqlConnection(b.ConnectionString);
            await m.OpenAsync();
            var exists = await m.ExecuteScalarAsync<int?>("SELECT 1 FROM sys.databases WHERE name = @name", new { name });
            if (exists is null)
            {
                log.LogInformation("Creating database {Name}", name);
                await m.ExecuteAsync($"CREATE DATABASE [{name.Replace("]", "]]")}]");
            }
        }
        catch (SqlException e) when (e.Number is 262 or 229 or 18456 or 4060)
        {
            // No permission to look at master: assume the database was created by an administrator.
        }
    }
}

/// <summary>Dapper settings: snake_case columns and JSON columns.</summary>
public static class DapperSetup
{
    public static void Configure()
    {
        DefaultTypeMap.MatchNamesWithUnderscores = true;
        SqlMapper.AddTypeHandler(new JsonHandler<List<OrderItem>>());
        SqlMapper.AddTypeHandler(new JsonNodeHandler());
    }

    private sealed class JsonHandler<T> : SqlMapper.TypeHandler<T>
    {
        public override T Parse(object value) => JsonSerializer.Deserialize<T>((string)value, Http.JsonOptions)!;
        public override void SetValue(IDbDataParameter p, T? value)
        {
            p.DbType = DbType.String;
            p.Value = JsonSerializer.Serialize(value, Http.JsonOptions);
        }
    }

    private sealed class JsonNodeHandler : SqlMapper.TypeHandler<JsonNode?>
    {
        public override JsonNode? Parse(object value) => value is string s ? JsonNode.Parse(s) : null;
        public override void SetValue(IDbDataParameter p, JsonNode? value)
        {
            p.DbType = DbType.String;
            p.Value = value is null ? "null" : value.ToJsonString(Http.JsonOptions);
        }
    }
}
