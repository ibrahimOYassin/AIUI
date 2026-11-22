// Run manually - starts the flow, using the test data when none was passed.
using System.Text.Json;
using System.Text.Json.Nodes;
using Aiui.Runtime;

namespace Aiui.Steps;

public static class TriggerManualStep
{
    public static Task<JsonNode?> RunAsync(JsonObject cfg, StepContext ctx)
    {
        var input = ctx.Data["input"];
        if (input is null || input is JsonObject { Count: 0 })
        {
            var sample = cfg["sampleInput"];
            if (sample is not null && sample.GetValueKind() == JsonValueKind.String) sample = J.ParseOrText(sample.GetValue<string>());
            ctx.Data["input"] = J.Clone(sample) ?? new JsonObject();
        }
        return Task.FromResult(J.Clone(ctx.Data["input"]));
    }
}
