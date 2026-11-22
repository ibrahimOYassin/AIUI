// When a webhook is called - passes the incoming request on to the flow.
using System.Text.Json;
using System.Text.Json.Nodes;
using Aiui.Runtime;

namespace Aiui.Steps;

public static class TriggerWebhookStep
{
    public static Task<JsonNode?> RunAsync(JsonObject cfg, StepContext ctx)
    {
        var input = ctx.Data["input"];
        if (input is null || input is JsonObject { Count: 0 })
        {
            var sample = cfg["sampleInput"];
            if (sample is not null && sample.GetValueKind() == JsonValueKind.String) sample = J.ParseOrText(sample.GetValue<string>());
            ctx.Data["input"] = J.Clone(sample) ?? new JsonObject { ["body"] = new JsonObject() };
        }
        return Task.FromResult(J.Clone(ctx.Data["input"]));
    }
}
