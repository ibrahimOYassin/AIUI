// Call MCP tool - runs one tool on a Model Context Protocol server.
using System.Text.Json;
using System.Text.Json.Nodes;
using Aiui.Runtime;

namespace Aiui.Steps;

public static class McpCallStep
{
    public static async Task<JsonNode?> RunAsync(JsonObject cfg, StepContext ctx)
    {
        var client = ctx.Mcp(ctx.Connection(J.Str(cfg, "connection")));
        var arguments = J.Clone(cfg["arguments"]);
        if (arguments is not null && arguments.GetValueKind() == JsonValueKind.String)
            arguments = J.ParseOrText(arguments.GetValue<string>());
        if (arguments is not null and not JsonObject) throw new InvalidOperationException("The tool input is not valid JSON.");
        var tool = J.Str(cfg, "tool").Trim();
        if (tool.Length == 0) throw new InvalidOperationException("The tool name is empty.");
        return await client.CallToolAsync(tool, arguments as JsonObject);
    }
}
