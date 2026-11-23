using System.Text.Json.Nodes;
using SuperWater.Api.Infrastructure;
using SuperWater.Api.Models;
using SuperWater.Api.Payments;
using SuperWater.Api.Services;

namespace SuperWater.Api.Endpoints;

/// <summary>
/// Admin API used by /admin (port of api/admin.js). Every action except login needs a signed-in user.
///   /api/admin?action=&lt;name&gt;
/// 'admin' users can do everything. 'production' users (facility staff) can see
/// orders, dispatch them, and manage stock; nothing else.
/// </summary>
public static class AdminEndpoint
{
    private static readonly string[] Both = ["admin", "production"];

    private const string UsersSql = "SELECT id, email, name, role, active, created_at FROM dbo.users ORDER BY id";

    public static async Task Handle(HttpContext ctx)
    {
        var sp = ctx.RequestServices;
        var config = sp.GetRequiredService<IConfiguration>();
        var q = Http.Query(ctx);
        var action = Http.Q(q, "action");

        // Setup check for the sign-in page. Reports only whether settings exist, never their values.
        if (action == "status") { await Http.Send(ctx, 200, await SetupStatus(sp, config)); return; }

        await sp.GetRequiredService<Schema>().Ensure();
        var db = sp.GetRequiredService<Db>();
        var auth = sp.GetRequiredService<Auth>();
        var orders = sp.GetRequiredService<Orders>();
        var gateways = sp.GetRequiredService<Gateways>();

        // ---------- sign in / out ----------
        if (action == "login")
        {
            Http.Method(ctx, "POST");
            var recordFailure = await auth.CheckLoginRate(ctx);
            var b = await Http.Body(ctx);
            var email = Js.OrEmpty(b, "email").Trim().ToLowerInvariant();
            var found = await db.One<UserRow>("SELECT * FROM dbo.users WHERE email = @email AND active = 1", new { email });
            if (found is null || !Auth.VerifyPassword(Js.OrEmpty(b, "password"), found.PasswordHash))
            {
                await recordFailure();
                throw new HttpError(401, "That email and password do not match an account.");
            }
            await Http.Send(ctx, 200, new { ok = true }, new Dictionary<string, string> { ["Set-Cookie"] = auth.SessionCookie(found.Id, found.PasswordHash, ctx) });
            return;
        }
        if (action == "logout") { await Http.Send(ctx, 200, new { ok = true }, new Dictionary<string, string> { ["Set-Cookie"] = Auth.ClearCookie() }); return; }

        var user = await auth.RequireUser(ctx, Both);
        var isAdmin = user.Role == "admin";
        void AdminOnly() { if (!isAdmin) throw new HttpError(403, "Only administrators can do this."); }
        var actor = user.Email;

        switch (action)
        {
            case "me":
            {
                var n = await db.Scalar<int>("SELECT COUNT(*) FROM dbo.users");
                await Http.Send(ctx, 200, new { user, users = n });
                return;
            }

            // ---------- overview ----------
            case "dashboard":
            {
                await orders.ExpireUnpaid();
                var counts = await db.One<DashboardCounts>(@"
                    SELECT
                      ISNULL(SUM(CASE WHEN created_at > DATEADD(day, -1, SYSDATETIMEOFFSET()) THEN 1 ELSE 0 END), 0) AS orders_24h,
                      ISNULL(SUM(CASE WHEN status = N'pending' THEN 1 ELSE 0 END), 0) AS to_confirm,
                      ISNULL(SUM(CASE WHEN status = N'confirmed' THEN 1 ELSE 0 END), 0) AS to_dispatch,
                      ISNULL(SUM(CASE WHEN payment_status = N'paid' AND created_at > DATEADD(day, -30, SYSDATETIMEOFFSET()) THEN total ELSE 0 END), 0) AS revenue_30d,
                      ISNULL(SUM(CASE WHEN payment_status = N'paid' AND created_at > DATEADD(day, -30, SYSDATETIMEOFFSET()) THEN 1 ELSE 0 END), 0) AS paid_30d
                    FROM dbo.orders");
                var recent = await db.Rows("SELECT TOP 8 id, code, customer_name, city, total, status, payment_status, payment_method, created_at FROM dbo.orders ORDER BY created_at DESC, id DESC");
                await Http.Send(ctx, 200, new { counts, stock = await Inventory.Levels(db), recent, gateways = GatewayStatus(gateways, config) });
                return;
            }

            // ---------- orders ----------
            case "orders":
            {
                var status = Http.Q(q, "status");
                var search = Http.Q(q, "q").Trim();
                var like = $"%{search}%";
                var rows = await db.Rows(@"
                    SELECT TOP 200 id, code, customer_name, phone, city, total, status, payment_status, payment_method, created_at
                    FROM dbo.orders
                    WHERE (@status = N'' OR status = @status)
                      AND (@search = N'' OR code LIKE @like OR customer_name LIKE @like OR phone LIKE @like)
                    ORDER BY created_at DESC, id DESC", new { status, search, like });
                await Http.Send(ctx, 200, new { orders = rows });
                return;
            }
            case "order":
            {
                var id = Http.Int(q.TryGetValue("id", out var s) ? s : null, "Order", min: 1);
                var o = await db.One<Order>("SELECT * FROM dbo.orders WHERE id = @id", new { id }) ?? throw new HttpError(404, "Order not found.");
                var events = new List<Dictionary<string, object?>>();
                if (isAdmin)
                {
                    events = await db.Rows("SELECT provider, kind, ok, payload, created_at FROM dbo.payment_events WHERE order_code = @code ORDER BY created_at, id", new { code = o.Code });
                    foreach (var e in events) e["payload"] = e["payload"] is string p ? JsonNode.Parse(p) : null;
                }
                await Http.Send(ctx, 200, new { order = o.WithoutToken(), events });
                return;
            }
            case "order-action":
            {
                Http.Method(ctx, "POST");
                var b = await Http.Body(ctx);
                var act = Js.OrEmpty(b, "action");
                if (!isAdmin && act != "dispatch") throw new HttpError(403, "Production accounts can only dispatch orders.");
                var o = await orders.StaffAction(Http.Int(b, "id", "Order", min: 1), act, actor);
                await Http.Send(ctx, 200, new { order = o.WithoutToken() });
                return;
            }

            // ---------- inventory ----------
            case "stock":
            {
                var moves = await db.Rows("SELECT TOP 100 * FROM dbo.stock_movements ORDER BY created_at DESC, id DESC");
                await Http.Send(ctx, 200, new { stock = await Inventory.Levels(db), movements = moves });
                return;
            }
            case "production":
            {
                Http.Method(ctx, "POST");
                var b = await Http.Body(ctx);
                await Inventory.AddProduction(db, Js.ToNumber(b, "size_ml"), Js.ToNumber(b, "quantity"),
                    Http.Str(b, "batch", "Batch", max: 60), Http.Str(b, "note", "Note", max: 300), actor);
                await Http.Send(ctx, 200, new { stock = await Inventory.Levels(db) });
                return;
            }
            case "stocktake":
            {
                Http.Method(ctx, "POST");
                var b = await Http.Body(ctx);
                var r = await Inventory.Stocktake(db, Js.ToNumber(b, "size_ml"), Js.ToNumber(b, "counted"), Http.Str(b, "note", "Note", max: 300), actor);
                await Http.Send(ctx, 200, new { previous = r.Previous, counted = r.Counted, change = r.Change, stock = await Inventory.Levels(db) });
                return;
            }
            case "adjust":
            {
                Http.Method(ctx, "POST");
                var b = await Http.Body(ctx);
                await Inventory.Adjust(db, Js.ToNumber(b, "size_ml"), Js.ToNumber(b, "change"), Http.Str(b, "note", "Reason", max: 300), actor);
                await Http.Send(ctx, 200, new { stock = await Inventory.Levels(db) });
                return;
            }
            case "threshold":
            {
                Http.Method(ctx, "POST");
                var b = await Http.Body(ctx);
                var size = Js.ToNumber(b, "size_ml");
                var t = Http.Int(b, "low_threshold", "Low-stock alert level", min: 0, max: 10_000_000);
                if (Js.IsInteger(size) && size is >= int.MinValue and <= int.MaxValue)
                    await db.Execute("UPDATE dbo.stock SET low_threshold = @t WHERE size_ml = @size", new { t, size = (int)size });
                await Http.Send(ctx, 200, new { stock = await Inventory.Levels(db) });
                return;
            }

            // ---------- content ----------
            case "content":
            {
                AdminOnly();
                var rows = await db.Rows("SELECT [key], updated_at, updated_by FROM dbo.content");
                await Http.Send(ctx, 200, new
                {
                    groups = CmsSchema.Groups,
                    defaults = Content.Defaults,
                    values = await Content.Overrides(db),
                    meta = rows.ToDictionary(r => (string)r["key"]!, r => r),
                });
                return;
            }
            case "content-save":
            {
                AdminOnly();
                Http.Method(ctx, "POST");
                var b = await Http.Body(ctx);
                var values = b["values"] as JsonObject ?? new JsonObject();
                var reset = b["reset"] as JsonArray ?? new JsonArray();
                // Validate everything before writing anything (an invalid field aborts the whole save).
                var cleaned = values.Select(kv => (kv.Key, Value: Content.CleanValue(kv.Key, kv.Value))).ToList();
                await db.Begin(async tx =>
                {
                    foreach (var (key, value) in cleaned)
                    {
                        if (Content.Json(value) == Content.Json(Content.Default(key)))
                        {
                            await tx.Execute("DELETE FROM dbo.content WHERE [key] = @key", new { key }); // same as the original: no override needed
                        }
                        else
                        {
                            var json = value.ToJsonString(Http.JsonOptions);
                            var n = await tx.Execute("UPDATE dbo.content SET value = @json, updated_at = SYSDATETIMEOFFSET(), updated_by = @actor WHERE [key] = @key", new { key, json, actor });
                            if (n == 0) await tx.Execute("INSERT INTO dbo.content ([key], value, updated_by) VALUES (@key, @json, @actor)", new { key, json, actor });
                        }
                    }
                    foreach (var k in reset) await tx.Execute("DELETE FROM dbo.content WHERE [key] = @key", new { key = k is null ? "null" : Js.ToStr(k) });
                });
                await Http.Send(ctx, 200, new { values = await Content.Overrides(db) });
                return;
            }

            // ---------- products ----------
            case "products":
            {
                AdminOnly();
                await Http.Send(ctx, 200, new { products = await db.Query<Product>("SELECT * FROM dbo.products ORDER BY sort") });
                return;
            }
            case "product-save":
            {
                AdminOnly();
                Http.Method(ctx, "POST");
                var b = await Http.Body(ctx);
                var sku = Js.OrEmpty(b, "sku");
                var name = Http.Str(b, "name", "Name", max: 80, required: true);
                var price = Http.Int(b, "price", "Price", min: 0, max: 1_000_000);
                var was = Http.Int(b, "was", "Regular price", min: 0, max: 1_000_000);
                var active = Js.Truthy(b, "active");
                var p = await db.One<Product>("UPDATE dbo.products SET name = @name, price = @price, was = @was, active = @active OUTPUT INSERTED.* WHERE sku = @sku",
                    new { name, price, was, active, sku }) ?? throw new HttpError(404, "Product not found.");
                await Http.Send(ctx, 200, new { product = p });
                return;
            }

            // ---------- people ----------
            case "users":
            {
                AdminOnly();
                await Http.Send(ctx, 200, new { users = await db.Rows(UsersSql) });
                return;
            }
            case "user-save":
            {
                AdminOnly();
                Http.Method(ctx, "POST");
                var b = await Http.Body(ctx);
                var email = Http.Str(b, "email", "Email", max: 120, required: true).ToLowerInvariant();
                if (!System.Text.RegularExpressions.Regex.IsMatch(email, @"^[^\s@]+@[^\s@]+\.[^\s@]+$")) throw new HttpError(400, "Enter a valid email address.");
                var role = b["role"] is JsonValue rv && rv.GetValueKind() == System.Text.Json.JsonValueKind.String && rv.GetValue<string>() == "admin" ? "admin" : "production";
                var name = Http.Str(b, "name", "Name", max: 80);
                var active = !Js.IsFalse(b, "active");
                var password = Js.OrEmpty(b, "password");
                if (password.Length > 0 && password.Length < 10) throw new HttpError(400, "Passwords need at least 10 characters.");
                if (Js.Truthy(b, "id"))
                {
                    var id = Http.Int(b, "id", "User", min: 1);
                    if (id == user.Id && (role != "admin" || !active)) throw new HttpError(400, "You cannot remove your own administrator access.");
                    try
                    {
                        await db.Execute("UPDATE dbo.users SET email = @email, name = @name, role = @role, active = @active WHERE id = @id", new { email, name, role, active, id });
                    }
                    catch (Exception e) when (Db.IsUniqueViolation(e))
                    {
                        throw new HttpError(409, "An account with that email already exists.");
                    }
                    if (password.Length > 0) await db.Execute("UPDATE dbo.users SET password_hash = @hash WHERE id = @id", new { hash = Auth.HashPassword(password), id });
                }
                else
                {
                    if (password.Length == 0) throw new HttpError(400, "Set a password for the new account (at least 10 characters).");
                    try
                    {
                        await db.Execute("INSERT INTO dbo.users (email, name, role, password_hash, active) VALUES (@email, @name, @role, @hash, @active)",
                            new { email, name, role, hash = Auth.HashPassword(password), active });
                    }
                    catch (Exception e) when (Db.IsUniqueViolation(e))
                    {
                        throw new HttpError(409, "An account with that email already exists.");
                    }
                }
                await Http.Send(ctx, 200, new { users = await db.Rows(UsersSql) });
                return;
            }
            case "password":
            {
                Http.Method(ctx, "POST");
                var b = await Http.Body(ctx);
                var hashNow = await db.Scalar<string>("SELECT password_hash FROM dbo.users WHERE id = @id", new { id = user.Id });
                if (!Auth.VerifyPassword(Js.OrEmpty(b, "current"), hashNow ?? "")) throw new HttpError(400, "Your current password is not correct.");
                var next = Js.OrEmpty(b, "next");
                if (next.Length < 10) throw new HttpError(400, "Your new password needs at least 10 characters.");
                var hash = Auth.HashPassword(next);
                await db.Execute("UPDATE dbo.users SET password_hash = @hash WHERE id = @id", new { hash, id = user.Id });
                await Http.Send(ctx, 200, new { ok = true }, new Dictionary<string, string> { ["Set-Cookie"] = auth.SessionCookie(user.Id, hash, ctx) });
                return;
            }

            // ---------- payments ----------
            case "gateways":
            {
                AdminOnly();
                await Http.Send(ctx, 200, new { gateways = GatewayStatus(gateways, config) });
                return;
            }
        }
        throw new HttpError(404, "Unknown request.");
    }

    private static object GatewayStatus(Gateways gateways, IConfiguration config)
    {
        var keys = new Dictionary<string, string[]>
        {
            ["sslcommerz"] = ["SSLCOMMERZ_STORE_ID", "SSLCOMMERZ_STORE_PASSWORD", "SSLCOMMERZ_LIVE (optional)"],
            ["bkash"] = ["BKASH_USERNAME", "BKASH_PASSWORD", "BKASH_APP_KEY", "BKASH_APP_SECRET", "BKASH_BASE_URL (live only)"],
        };
        return gateways.All.Select(g => new
        {
            id = g.Id,
            label = g.Label,
            configured = g.Configured(),
            live = g.Id == "sslcommerz" ? config["SSLCOMMERZ_LIVE"] == "true" : g.Id == "bkash" && !string.IsNullOrEmpty(config["BKASH_BASE_URL"]),
            env = keys.TryGetValue(g.Id, out var k) ? k : [],
        }).ToList();
    }

    private sealed record Check(bool Ok, string Message);

    private static async Task<object> SetupStatus(IServiceProvider sp, IConfiguration config)
    {
        string Env(string k) => (config[k] ?? "").Trim();
        var cs = Db.ConnectionString(config);
        var email = Env("ADMIN_EMAIL");
        var password = config["ADMIN_PASSWORD"] ?? "";
        var secret = Env("SESSION_SECRET");
        var database = new Check(false, "");
        var sessionSecret = new Check(secret.Length >= 32, secret.Length > 0 ? (secret.Length >= 32 ? "" : "SESSION_SECRET is shorter than 32 characters.") : "SESSION_SECRET is not set.");
        var admin = new Check(false, "");
        if (cs is null) database = database with { Message = "No database connection string. Set ConnectionStrings:SuperWater in appsettings.json." };
        else
        {
            try
            {
                await sp.GetRequiredService<Schema>().Ensure();
                database = database with { Ok = true };
                var n = await sp.GetRequiredService<Db>().Scalar<int>("SELECT COUNT(*) FROM dbo.users WHERE active = 1");
                if (n > 0) admin = admin with { Ok = true };
                else if (email.Length == 0) admin = admin with { Message = "No admin account yet, and ADMIN_EMAIL is not set." };
                else if (password.Length < 10) admin = admin with { Message = password.Length > 0 ? "ADMIN_PASSWORD must have at least 10 characters." : "No admin account yet, and ADMIN_PASSWORD is not set." };
                else admin = admin with { Message = "Settings found but no account yet. Restart the server, then reload this page." };
            }
            catch (Exception e)
            {
                var m = e.Message;
                database = database with { Message = $"Could not connect to the database: {(m.Length > 160 ? m[..160] : m)}" };
            }
        }
        if (!admin.Ok && admin.Message.Length == 0) admin = admin with { Message = "Waiting for the database." };
        return new Dictionary<string, object>
        {
            ["database"] = new { ok = database.Ok, message = database.Message },
            ["session_secret"] = new { ok = sessionSecret.Ok, message = sessionSecret.Message },
            ["admin"] = new { ok = admin.Ok, message = admin.Message },
            ["ready"] = database.Ok && sessionSecret.Ok && admin.Ok,
        };
    }
}
