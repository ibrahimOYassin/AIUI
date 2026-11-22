// Save file - writes text to disk, creating folders as needed.
using System.Text.Json.Nodes;
using Aiui.Runtime;

namespace Aiui.Steps;

public static class FileWriteStep
{
    public static async Task<JsonNode?> RunAsync(JsonObject cfg, StepContext ctx)
    {
        var path = J.Str(cfg, "path").Trim();
        if (path.Length == 0) throw new InvalidOperationException("The file path is empty.");
        var folder = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(folder)) Directory.CreateDirectory(folder);
        var content = J.Text(cfg["content"]);
        if (J.Bool(cfg, "append")) await File.AppendAllTextAsync(path, content);
        else await File.WriteAllTextAsync(path, content);
        return new JsonObject { ["path"] = path, ["size"] = new FileInfo(path).Length };
    }
}
