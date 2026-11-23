using SuperWater.Api.Infrastructure;

namespace SuperWater.Api.Endpoints;

public static class Handler
{
    /// <summary>Wraps an endpoint: JSON errors, no caching of private data (port of handler() in lib/http.js).</summary>
    public static RequestDelegate Wrap(Func<HttpContext, Task> fn) => async ctx =>
    {
        try
        {
            await fn(ctx);
        }
        catch (HttpError e)
        {
            if (e.Status >= 500) ctx.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("SuperWater").LogError(e, "{Message}", e.Message);
            if (!ctx.Response.HasStarted) await Http.Send(ctx, e.Status, new { error = e.Message });
        }
        catch (Exception e)
        {
            ctx.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("SuperWater").LogError(e, "Unhandled error");
            if (!ctx.Response.HasStarted) await Http.Send(ctx, 500, new { error = "Something went wrong on the server. Please try again." });
        }
    };
}
