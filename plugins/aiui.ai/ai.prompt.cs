// Ask AI - one question, one answer.
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Aiui.Runtime;

namespace Aiui.Steps;

public static class AiPromptStep
{
    public static async Task<JsonNode?> RunAsync(JsonObject cfg, StepContext ctx)
    {
        var conn = ctx.Connection(J.Str(cfg, "connection"));
        var options = new JsonObject { ["temperature"] = J.Clone(cfg["temperature"]), ["max_tokens"] = J.Clone(cfg["maxTokens"]) };
        var text = await ctx.LlmChatAsync(conn, J.Text(cfg["prompt"]), J.Text(cfg["system"]), null, options);
        var result = new JsonObject { ["text"] = text, ["data"] = null };
        if (J.Bool(cfg, "parseJson"))
        {
            var cleaned = Regex.Replace(text.Trim(), @"^```[a-zA-Z]*\s*|\s*```$", "");
            try { result["data"] = JsonNode.Parse(cleaned); }
            catch (JsonException) { ctx.Log("The answer was not valid JSON; 'data' is empty.", "warn"); }
        }
        return result;
    }
}
