using System.Text.Json.Serialization;

namespace SuperWater.Api.Models;

// Property names are written to JSON in snake_case (Http.JsonOptions), matching
// the original API exactly: SizeMl → "size_ml", PaymentStatus → "payment_status".

public sealed class OrderItem
{
    public string Sku { get; set; } = "";
    public string Name { get; set; } = "";
    public int Qty { get; set; }
    public int Price { get; set; }
    public int SizeMl { get; set; }
    public int Bottles { get; set; }
}

public sealed class Order
{
    public int Id { get; set; }
    public string Code { get; set; } = "";
    public string? PublicToken { get; set; }
    public string CustomerName { get; set; } = "";
    public string Phone { get; set; } = "";
    public string? Email { get; set; }
    public string Address { get; set; } = "";
    public string City { get; set; } = "";
    public string? Note { get; set; }
    public List<OrderItem> Items { get; set; } = [];
    public int Subtotal { get; set; }
    public int DeliveryFee { get; set; }
    public int Total { get; set; }
    public string PaymentMethod { get; set; } = "";
    public string PaymentStatus { get; set; } = "";
    public string Status { get; set; } = "";
    public string StockState { get; set; } = "";
    public string? ProviderRef { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }

    /// <summary>The order without its private token (JS: delete o.public_token).</summary>
    public Dictionary<string, object?> WithoutToken()
    {
        var d = new Dictionary<string, object?>
        {
            ["id"] = Id, ["code"] = Code, ["customer_name"] = CustomerName, ["phone"] = Phone, ["email"] = Email,
            ["address"] = Address, ["city"] = City, ["note"] = Note, ["items"] = Items, ["subtotal"] = Subtotal,
            ["delivery_fee"] = DeliveryFee, ["total"] = Total, ["payment_method"] = PaymentMethod,
            ["payment_status"] = PaymentStatus, ["status"] = Status, ["stock_state"] = StockState,
            ["provider_ref"] = ProviderRef, ["created_at"] = CreatedAt, ["updated_at"] = UpdatedAt,
        };
        return d;
    }
}

public sealed class Product
{
    public string Sku { get; set; } = "";
    public string Name { get; set; } = "";
    public int SizeMl { get; set; }
    public int Bottles { get; set; }
    public int Price { get; set; }
    public int Was { get; set; }
    public bool Active { get; set; }
    public int Sort { get; set; }
}

public sealed class StockLevel
{
    public int SizeMl { get; set; }
    public int OnHand { get; set; }
    public int Reserved { get; set; }
    public int LowThreshold { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public int Available { get; set; }
    public bool Low { get; set; }
}

public sealed class UserRow
{
    public int Id { get; set; }
    public string Email { get; set; } = "";
    public string Name { get; set; } = "";
    public string Role { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public bool Active { get; set; }
}

/// <summary>The signed-in user as returned to the admin (no password hash).</summary>
public sealed record SessionUser(int Id, string Email, string Name, string Role, bool Active)
{
    [JsonIgnore] public string PasswordHash { get; init; } = "";
}

public sealed class DashboardCounts
{
    [JsonPropertyName("orders_24h")] public int Orders24h { get; set; }
    [JsonPropertyName("to_confirm")] public int ToConfirm { get; set; }
    [JsonPropertyName("to_dispatch")] public int ToDispatch { get; set; }
    [JsonPropertyName("revenue_30d")] public int Revenue30d { get; set; }
    [JsonPropertyName("paid_30d")] public int Paid30d { get; set; }
}

public sealed class CustomerRow
{
    public int Id { get; set; }
    public string Email { get; set; } = "";
    public string Name { get; set; } = "";
    public string Phone { get; set; } = "";
    public string Address { get; set; } = "";
    public string City { get; set; } = "";
    public string PasswordHash { get; set; } = "";
}
