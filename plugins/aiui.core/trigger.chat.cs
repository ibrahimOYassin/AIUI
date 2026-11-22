// When a chat message arrives - makes sure the flow has a message and a history.
using System.Text.Json.Nodes;
using Aiui.Runtime;

namespace Aiui.Steps;

public static class TriggerChatStep
{
    public static Task<JsonNode?> RunAsync(JsonObject cfg, StepContext ctx)
    {
        var data = J.Clone(ctx.Data["input"]) as JsonObject;
        if (data is null || J.Str(data, "message").Length == 0)
            data = new JsonObject { ["message"] = J.Str(cfg, "sampleMessage", "Hello!"), ["history"] = new JsonArray() };
        if (data["history"] is null) data["history"] = new JsonArray();
        ctx.Data["input"] = data;
        return Task.FromResult(J.Clone(data));
    }
}
