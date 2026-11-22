// Wait - pauses the flow.
using System.Text.Json.Nodes;
using Aiui.Runtime;

namespace Aiui.Steps;

public static class LogicDelayStep
{
    public static async Task<JsonNode?> RunAsync(JsonObject cfg, StepContext ctx)
    {
        var seconds = Math.Max(0, J.Num(cfg, "seconds"));
        await Task.Delay(TimeSpan.FromSeconds(seconds));
        return new JsonObject { ["waited"] = seconds };
    }
}
