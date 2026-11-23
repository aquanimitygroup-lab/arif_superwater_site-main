using SuperWater.Api.Infrastructure;
using SuperWater.Api.Models;
using SuperWater.Api.Services;

namespace SuperWater.Api.Endpoints;

/// <summary>
/// Public endpoints used by the website (port of api/site.js).
///   GET  /api/site?action=content            text, prices, stock, checkout options
///   POST /api/site?action=order              place an order
///   GET  /api/site?action=order&amp;code=&amp;token= a customer's own order
/// </summary>
public static class SiteEndpoint
{
    public static async Task Handle(HttpContext ctx)
    {
        var sp = ctx.RequestServices;
        await sp.GetRequiredService<Schema>().Ensure();
        var db = sp.GetRequiredService<Db>();
        var orders = sp.GetRequiredService<Orders>();
        var q = Http.Query(ctx);
        var action = Http.Q(q, "action");

        if (action == "content")
        {
            Http.Method(ctx, "GET");
            await orders.ExpireUnpaid();
            var changed = await Content.Overrides(db);
            var content = await Content.All(db);
            var products = await db.Rows("SELECT sku, name, size_ml, bottles, price, was, active FROM dbo.products ORDER BY sort");
            var stock = await Inventory.Levels(db);
            var available = stock.ToDictionary(s => s.SizeMl.ToString(), s => Math.Max(s.Available, 0));
            await Http.Send(ctx, 200, new
            {
                content = changed,
                products,
                available,
                checkout = await orders.CheckoutOptions(content),
            }, new Dictionary<string, string> { ["Cache-Control"] = "no-cache", ["CDN-Cache-Control"] = "max-age=10" }); // browsers always ask; a CDN may reuse for 10 s
            return;
        }

        if (action == "order" && ctx.Request.Method == "POST")
        {
            var input = await Http.Body(ctx);
            var site = Http.SiteUrl(ctx, sp.GetRequiredService<IConfiguration>());
            var created = await orders.Create(input,
                (provider, act, code) => $"{site}/api/payment?provider={provider}&action={act}&order={Uri.EscapeDataString(code)}");
            var content = await Content.All(db);
            await Http.Send(ctx, 201, new Dictionary<string, object?>
            {
                ["code"] = created.Order.Code,
                ["token"] = created.Order.PublicToken,
                ["total"] = created.Order.Total,
                ["redirectUrl"] = created.RedirectUrl,
                ["message"] = created.RedirectUrl is not null ? null : Content.Text(content, "order.thanks"),
            });
            return;
        }

        if (action == "order" && ctx.Request.Method == "GET")
        {
            var o = await db.One<Order>("SELECT * FROM dbo.orders WHERE code = @code", new { code = Http.Q(q, "code") });
            if (o is null || o.PublicToken != Http.Q(q, "token")) throw new HttpError(404, "Order not found. Check the link in your confirmation.");
            await Http.Send(ctx, 200, Orders.PublicOrder(o));
            return;
        }

        // ---------- customer accounts ----------
        if (action is "register" or "login" or "logout" or "me" or "profile")
        {
            var auth = sp.GetRequiredService<Auth>();
            if (action == "me")
            {
                Http.Method(ctx, "GET");
                await Http.Send(ctx, 200, new { customer = CustomerView(await auth.CurrentCustomer(ctx)) });
                return;
            }
            Http.Method(ctx, "POST");
            if (ctx.Request.Headers["x-sw-site"].ToString() != "1") throw new HttpError(403, "Request blocked.");
            if (action == "logout")
            {
                await Http.Send(ctx, 200, new { ok = true }, new Dictionary<string, string> { ["Set-Cookie"] = Auth.ClearCustomerCookie() });
                return;
            }
            var b = await Http.Body(ctx);
            if (action == "profile")
            {
                var me = await auth.CurrentCustomer(ctx) ?? throw new HttpError(401, "Please sign in.");
                var upd = new
                {
                    id = me.Id,
                    name = Http.Str(b, "name", "Name", 80, required: true),
                    phone = Http.Str(b, "phone", "Mobile number", 20),
                    address = Http.Str(b, "address", "Address", 300),
                    city = Http.Str(b, "city", "Area or city", 60),
                };
                await db.Execute("UPDATE dbo.customers SET name=@name, phone=@phone, address=@address, city=@city WHERE id=@id", upd);
                await Http.Send(ctx, 200, new { customer = CustomerView(await auth.CurrentCustomer(ctx)) });
                return;
            }
            var recordFailure = await auth.CheckLoginRate(ctx);
            var email = Http.Str(b, "email", "Email", 254, required: true).ToLowerInvariant();
            var password = Js.OrEmpty(b, "password");
            if (action == "login")
            {
                var c = await db.One<CustomerRow>("SELECT * FROM dbo.customers WHERE email = @email", new { email });
                if (c is null || !Auth.VerifyPassword(password, c.PasswordHash))
                {
                    // Staff / admin sign in from the same form and are sent to /admin.
                    var staff = await db.One<UserRow>("SELECT * FROM dbo.users WHERE email = @email AND active = 1", new { email });
                    if (staff is not null && Auth.VerifyPassword(password, staff.PasswordHash))
                    {
                        await Http.Send(ctx, 200, new { staff = true, redirect = "/admin" },
                            new Dictionary<string, string> { ["Set-Cookie"] = auth.SessionCookie(staff.Id, staff.PasswordHash, ctx) });
                        return;
                    }
                    await recordFailure();
                    throw new HttpError(401, "That email and password do not match an account.");
                }
                await Http.Send(ctx, 200, new { customer = CustomerView(c) },
                    new Dictionary<string, string> { ["Set-Cookie"] = auth.CustomerSessionCookie(c.Id, c.PasswordHash, ctx) });
                return;
            }
            // register
            if (!System.Text.RegularExpressions.Regex.IsMatch(email, @"^[^\s@]+@[^\s@]+\.[^\s@]+$")) throw new HttpError(400, "Enter a valid email address.");
            if (password.Length < 8) throw new HttpError(400, "Password must be at least 8 characters.");
            if (password.Length > 200) throw new HttpError(400, "Password is too long.");
            var reg = new
            {
                email,
                name = Http.Str(b, "name", "Name", 80, required: true),
                phone = Http.Str(b, "phone", "Mobile number", 20),
                address = Http.Str(b, "address", "Address", 300),
                city = Http.Str(b, "city", "Area or city", 60),
                hash = Auth.HashPassword(password),
            };
            int id;
            try
            {
                id = await db.Scalar<int>(@"INSERT INTO dbo.customers (email, name, phone, address, city, password_hash)
                    OUTPUT INSERTED.id VALUES (@email, @name, @phone, @address, @city, @hash)", reg);
            }
            catch (Exception e) when (Db.IsUniqueViolation(e))
            {
                await recordFailure();
                throw new HttpError(409, "An account with this email already exists. Please sign in.");
            }
            var created = await db.One<CustomerRow>("SELECT * FROM dbo.customers WHERE id = @id", new { id });
            await Http.Send(ctx, 201, new { customer = CustomerView(created) },
                new Dictionary<string, string> { ["Set-Cookie"] = auth.CustomerSessionCookie(id, created!.PasswordHash, ctx) });
            return;
        }

        throw new HttpError(404, "Unknown request.");
    }

    private static object? CustomerView(CustomerRow? c) => c is null ? null : new { c.Id, c.Email, c.Name, c.Phone, c.Address, c.City };
}