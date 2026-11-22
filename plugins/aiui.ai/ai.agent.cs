// AI Agent - the model works on the task and may call the steps linked to its Tools port.
using System.Text.Json.Nodes;
using Aiui.Runtime;

namespace Aiui.Steps;

public static class AiAgentStep
{
    public static Task<JsonNode?> RunAsync(JsonObject cfg, StepContext ctx) => ctx.RunAgentAsync(cfg);
}
