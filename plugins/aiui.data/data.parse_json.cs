// Read JSON - turns JSON text into data.
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Aiui.Runtime;

namespace Aiui.Steps;

public static class DataParseJsonStep
{
    public static Task<JsonNode?> RunAsync(JsonObject cfg, StepContext ctx)
    {
        var value = cfg["text"];
        if (value is null || value.GetValueKind() != JsonValueKind.String)
            return Task.FromResult<JsonNode?>(new JsonObject { ["data"] = J.Clone(value) });
        var cleaned = Regex.Replace(value.GetValue<string>().Trim(), @"^```[a-zA-Z]*\s*|\s*```$", "");
        try
        {
            return Task.FromResult<JsonNode?>(new JsonObject { ["data"] = JsonNode.Parse(cleaned) });
        }
        catch (JsonException error)
        {
            throw new InvalidOperationException($"The text is not valid JSON: {error.Message}");
        }
    }
}
