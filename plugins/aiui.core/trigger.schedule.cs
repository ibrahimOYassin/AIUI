// On a schedule - the runtime repeats the flow; this step reports when a round started.
using System.Text.Json.Nodes;
using Aiui.Runtime;

namespace Aiui.Steps;

public static class TriggerScheduleStep
{
    public static Task<JsonNode?> RunAsync(JsonObject cfg, StepContext ctx)
    {
        var result = J.Clone(ctx.Data["input"]) as JsonObject ?? new JsonObject();
        result["startedAt"] = DateTimeOffset.UtcNow.ToString("o");
        ctx.Data["input"] = result;
        return Task.FromResult(J.Clone(result));
    }
}
