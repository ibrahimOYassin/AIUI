// Set variables - stores values that later steps read as vars.<name>.
using System.Text.Json.Nodes;
using Aiui.Runtime;

namespace Aiui.Steps;

public static class LogicSetStep
{
    public static Task<JsonNode?> RunAsync(JsonObject cfg, StepContext ctx)
    {
        if (cfg["values"] is JsonObject values)
            foreach (var pair in values) ctx.Vars[pair.Key] = J.Clone(pair.Value);
        return Task.FromResult(J.Clone(ctx.Vars));
    }
}
