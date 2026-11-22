// Log message - writes a line to the run log.
using System.Text.Json.Nodes;
using Aiui.Runtime;

namespace Aiui.Steps;

public static class UtilLogStep
{
    public static Task<JsonNode?> RunAsync(JsonObject cfg, StepContext ctx)
    {
        var message = J.Text(cfg["message"]);
        ctx.Log(message, J.Str(cfg, "level", "info"));
        return Task.FromResult<JsonNode?>(new JsonObject { ["message"] = message });
    }
}
