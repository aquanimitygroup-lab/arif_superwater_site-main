using Dapper;
using Microsoft.Data.SqlClient;
using SuperWater.Api.Models;
using SuperWater.Api.Services;

namespace SuperWater.Api.Infrastructure;

/// <summary>Starting data (port of lib/seed.js).</summary>
public static class Seed
{
    // Starting product list and prices. After the first run, change prices in
    // Admin → Products & prices; this list is only used to fill an empty table.
    public static readonly Product[] DefaultProducts =
    [
        new() { Sku = "single-500", Name = "Single · 500 mL", SizeMl = 500, Bottles = 1, Price = 30, Was = 35, Sort = 1, Active = true },
        new() { Sku = "day-500", Name = "Day Pack · 4 × 500 mL", SizeMl = 500, Bottles = 4, Price = 120, Was = 140, Sort = 2, Active = true },
        new() { Sku = "case-500", Name = "Case · 24 × 500 mL", SizeMl = 500, Bottles = 24, Price = 720, Was = 840, Sort = 3, Active = true },
        new() { Sku = "single-2000", Name = "Single · 2 L", SizeMl = 2000, Bottles = 1, Price = 90, Was = 100, Sort = 4, Active = true },
        new() { Sku = "case-2000", Name = "Case · 6 × 2 L", SizeMl = 2000, Bottles = 6, Price = 540, Was = 600, Sort = 5, Active = true },
        new() { Sku = "case5-2000", Name = "5 cases · 30 × 2 L", SizeMl = 2000, Bottles = 30, Price = 2700, Was = 3000, Sort = 6, Active = true },
    ];

    public static async Task Defaults(SqlConnection c, IConfiguration config)
    {
        foreach (var p in DefaultProducts)
        {
            await c.ExecuteAsync(@"IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE sku = @Sku)
                                   INSERT INTO dbo.products (sku, name, size_ml, bottles, price, was, sort)
                                   VALUES (@Sku, @Name, @SizeMl, @Bottles, @Price, @Was, @Sort)", p);
        }
        foreach (var size in Inventory.Sizes)
            await c.ExecuteAsync("IF NOT EXISTS (SELECT 1 FROM dbo.stock WHERE size_ml = @size) INSERT INTO dbo.stock (size_ml) VALUES (@size)", new { size });

        // The first administrator is created from the settings ONCE, when the database is new. It is remembered in
        // app_state, so deleting the user later does not bring the account back (and the password from appsettings
        // stops working). To create it again on purpose, set ADMIN_RESEED to true and restart.
        var n = await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.users");
        var seeded = await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.app_state WHERE [key] = N'admin_seeded'") > 0;
        var email = (config["ADMIN_EMAIL"] ?? "").Trim().ToLowerInvariant();
        var password = config["ADMIN_PASSWORD"] ?? "";
        var reseed = (config["ADMIN_RESEED"] ?? "").Trim().ToLowerInvariant() == "true";
        if (n == 0 && (!seeded || reseed) && email.Length > 0 && password.Length >= 10)
        {
            await c.ExecuteAsync(@"IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE email = @email)
                                   INSERT INTO dbo.users (email, name, role, password_hash) VALUES (@email, N'Administrator', N'admin', @hash)",
                new { email, hash = Auth.HashPassword(password) });
            n = 1;
        }
        if (n > 0 && !seeded)
            await c.ExecuteAsync("INSERT INTO dbo.app_state ([key], value) VALUES (N'admin_seeded', N'true')");
    }
}
