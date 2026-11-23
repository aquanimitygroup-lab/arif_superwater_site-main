namespace SuperWater.Api.Infrastructure;

/// <summary>An error whose message is safe to show to the person using the site.</summary>
public sealed class HttpError(int status, string message) : Exception(message)
{
    public int Status { get; } = status;
}
