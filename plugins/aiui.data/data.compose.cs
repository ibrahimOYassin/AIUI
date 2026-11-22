// Compose text - the references were already filled in by the runtime.
using System.Text.Json.Nodes;
using Aiui.Runtime;

namespace Aiui.Steps;

public static class DataComposeStep
{
    public static Task<JsonNode?> RunAsync(JsonObject cfg, StepContext ctx)
    {
        var text = J.Text(cfg["text"]);
        return Task.FromResult<JsonNode?>(new JsonObject { ["text"] = text, ["length"] = text.Length });
    }
}
