// Read file - as text, JSON or a list of lines.
using System.Text.Json;
using System.Text.Json.Nodes;
using Aiui.Runtime;

namespace Aiui.Steps;

public static class FileReadStep
{
    public static async Task<JsonNode?> RunAsync(JsonObject cfg, StepContext ctx)
    {
        var path = J.Str(cfg, "path").Trim();
        if (path.Length == 0) throw new InvalidOperationException("The file path is empty.");
        if (!File.Exists(path)) throw new InvalidOperationException($"File not found: {path}");
        var text = await File.ReadAllTextAsync(path);
        JsonNode? content;
        switch (J.Str(cfg, "format", "text"))
        {
            case "json":
                try { content = JsonNode.Parse(text); }
                catch (JsonException error) { throw new InvalidOperationException($"{path} is not valid JSON: {error.Message}"); }
                break;
            case "lines":
                var lines = new JsonArray();
                foreach (var line in text.Split('\n')) lines.Add(line.TrimEnd('\r'));
                content = lines;
                break;
            default:
                content = text;
                break;
        }
        return new JsonObject { ["path"] = path, ["content"] = content, ["size"] = new FileInfo(path).Length };
    }
}
