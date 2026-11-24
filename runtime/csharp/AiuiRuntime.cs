// AIUI runtime - the engine shipped with every generated project.
//
// It walks the workflow graph, resolves {{references}}, calls the step classes in
// Steps/, and provides the helpers steps rely on (HTTP, LLM chat, agents, MCP).
// Base class library only. Claude support lives in AnthropicChat.cs, which is added
// (with the Anthropic NuGet package) only when a connection uses that provider.

using System.Diagnostics;
using System.Net;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Aiui.Runtime;

public delegate Task<JsonNode?> StepFunc(JsonObject cfg, StepContext ctx);

public sealed class StepFailedException(string nodeName, string message)
    : Exception($"Step '{nodeName}' failed: {message}")
{
    public string NodeName { get; } = nodeName;
}

// ----------------------------------------------------------------------------
// JSON helpers and references
// ----------------------------------------------------------------------------

public static class J
{
    static readonly Regex Ref = new(@"\{\{\s*([^{}]+?)\s*\}\}", RegexOptions.Compiled);
    static readonly Regex Whole = new(@"^\{\{\s*([^{}]+?)\s*\}\}$", RegexOptions.Compiled);
    static readonly Regex EnvRef = new(@"\$\{([A-Za-z0-9_]+)\}", RegexOptions.Compiled);
    public static readonly JsonSerializerOptions Compact = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    public static string Json(JsonNode? value) => value is null ? "null" : value.ToJsonString(Compact);

    /// <summary>How a value looks when placed inside text.</summary>
    public static string Text(JsonNode? value)
    {
        if (value is null) return "";
        return value.GetValueKind() switch
        {
            JsonValueKind.String => value.GetValue<string>(),
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            JsonValueKind.Null => "",
            _ => Json(value),
        };
    }

    public static string Str(JsonObject obj, string key, string fallback = "")
    {
        var text = obj.TryGetPropertyValue(key, out var node) ? Text(node) : "";
        return text.Length == 0 ? fallback : text;
    }

    public static double Num(JsonObject obj, string key, double fallback = 0)
    {
        if (!obj.TryGetPropertyValue(key, out var node) || node is null) return fallback;
        return double.TryParse(Text(node), System.Globalization.NumberStyles.Float,
            System.Globalization.CultureInfo.InvariantCulture, out var number) ? number : fallback;
    }

    public static bool Bool(JsonObject obj, string key, bool fallback = false)
    {
        if (!obj.TryGetPropertyValue(key, out var node) || node is null) return fallback;
        return node.GetValueKind() switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.String => node.GetValue<string>().Equals("true", StringComparison.OrdinalIgnoreCase),
            _ => fallback,
        };
    }

    public static JsonNode? Clone(JsonNode? value) => value?.DeepClone();

    /// <summary>Look up a.b.0.c in the scope. A missing part gives null.</summary>
    public static JsonNode? Resolve(string path, JsonNode? scope)
    {
        var current = scope;
        foreach (var raw in path.Trim().Split('.'))
        {
            var part = raw.Trim();
            if (current is JsonObject obj) current = obj.TryGetPropertyValue(part, out var next) ? next : null;
            else if (current is JsonArray arr) current = int.TryParse(part, out var i) && i >= 0 && i < arr.Count ? arr[i] : null;
            else return null;
        }
        return current;
    }

    /// <summary>
    /// Replace {{references}} in strings, recursively. A string that is exactly one
    /// reference keeps the referenced value's type. Always returns a detached copy.
    /// </summary>
    public static JsonNode? Render(JsonNode? value, JsonObject scope)
    {
        switch (value)
        {
            case null:
                return null;
            case JsonObject obj:
            {
                var result = new JsonObject();
                foreach (var pair in obj) result[pair.Key] = Render(pair.Value, scope);
                return result;
            }
            case JsonArray arr:
            {
                var result = new JsonArray();
                foreach (var item in arr) result.Add(Render(item, scope));
                return result;
            }
            default:
                if (value.GetValueKind() != JsonValueKind.String) return value.DeepClone();
                var text = value.GetValue<string>();
                var whole = Whole.Match(text.Trim());
                if (whole.Success) return Clone(Resolve(whole.Groups[1].Value, scope));
                return Ref.Replace(text, m => Text(Resolve(m.Groups[1].Value, scope)));
        }
    }

    public static JsonNode? ExpandEnv(JsonNode? value)
    {
        switch (value)
        {
            case JsonObject obj:
            {
                var result = new JsonObject();
                foreach (var pair in obj) result[pair.Key] = ExpandEnv(pair.Value);
                return result;
            }
            case JsonArray arr:
            {
                var result = new JsonArray();
                foreach (var item in arr) result.Add(ExpandEnv(item));
                return result;
            }
            case null:
                return null;
            default:
                if (value.GetValueKind() != JsonValueKind.String) return value.DeepClone();
                return EnvRef.Replace(value.GetValue<string>(), m => Environment.GetEnvironmentVariable(m.Groups[1].Value) ?? "");
        }
    }

    public static JsonNode? ParseOrText(string text)
    {
        var trimmed = text.TrimStart();
        if (trimmed.StartsWith('{') || trimmed.StartsWith('['))
        {
            try { return JsonNode.Parse(text); } catch (JsonException) { }
        }
        return text;
    }
}

// ----------------------------------------------------------------------------
// HTTP
// ----------------------------------------------------------------------------

public static class Http
{
    static readonly HttpClient Client = new() { Timeout = Timeout.InfiniteTimeSpan };

    /// <summary>Make an HTTP request. Never throws for 4xx/5xx; check result["ok"].</summary>
    public static async Task<JsonObject> SendAsync(string method, string url, JsonObject? headers = null,
        JsonNode? body = null, double timeoutSeconds = 60, byte[]? rawBody = null)
    {
        using var request = new HttpRequestMessage(new HttpMethod(method.ToUpperInvariant()), url);
        string? contentType = null;
        if (headers is not null)
        {
            foreach (var pair in headers)
            {
                if (pair.Key.Equals("content-type", StringComparison.OrdinalIgnoreCase)) contentType = J.Text(pair.Value);
            }
        }
        if (rawBody is not null)
        {
            request.Content = new ByteArrayContent(rawBody);
        }
        else if (body is not null)
        {
            if (body.GetValueKind() == JsonValueKind.String)
            {
                var text = body.GetValue<string>();
                if (text.Length > 0) request.Content = new StringContent(text, Encoding.UTF8);
            }
            else
            {
                request.Content = new StringContent(J.Json(body), Encoding.UTF8);
                contentType ??= "application/json";
            }
        }
        if (request.Content is not null)
        {
            request.Content.Headers.Remove("Content-Type");
            if (contentType is not null) request.Content.Headers.TryAddWithoutValidation("Content-Type", contentType);
        }
        if (headers is not null)
        {
            foreach (var pair in headers)
            {
                if (pair.Key.Equals("content-type", StringComparison.OrdinalIgnoreCase)) continue;
                request.Headers.TryAddWithoutValidation(pair.Key, J.Text(pair.Value));
            }
        }
        if (!request.Headers.Contains("User-Agent")) request.Headers.TryAddWithoutValidation("User-Agent", "aiui-runtime/1.0");

        using var cancel = new CancellationTokenSource(TimeSpan.FromSeconds(timeoutSeconds));
        HttpResponseMessage response;
        try
        {
            response = await Client.SendAsync(request, cancel.Token);
        }
        catch (HttpRequestException error)
        {
            throw new InvalidOperationException($"Could not reach {url}: {error.Message}");
        }
        catch (OperationCanceledException)
        {
            throw new InvalidOperationException($"The request to {url} timed out.");
        }
        using (response)
        {
            var text = await response.Content.ReadAsStringAsync();
            var responseHeaders = new JsonObject();
            foreach (var header in response.Headers) responseHeaders[header.Key.ToLowerInvariant()] = string.Join(", ", header.Value);
            foreach (var header in response.Content.Headers) responseHeaders[header.Key.ToLowerInvariant()] = string.Join(", ", header.Value);
            return new JsonObject
            {
                ["status"] = (int)response.StatusCode,
                ["ok"] = response.IsSuccessStatusCode,
                ["headers"] = responseHeaders,
                ["body"] = J.ParseOrText(text),
                ["text"] = text,
            };
        }
    }
}

// ----------------------------------------------------------------------------
// LLM chat - one small adapter per provider, same interface
// ----------------------------------------------------------------------------

public sealed record ToolSpec(string Name, string Description, JsonObject Parameters);
public sealed record ToolCall(string Id, string Name, JsonObject Arguments);
public sealed record ToolResult(string Id, string Content, bool IsError);

public interface IChat
{
    void AddText(string role, string text);
    void AddToolResults(IReadOnlyList<ToolResult> results);
    Task<(string Text, List<ToolCall> Calls)> StepAsync();
}

public static class Llm
{
    public delegate IChat Factory(JsonObject conn, string system, IReadOnlyList<ToolSpec> tools, JsonObject options);

    public static readonly Dictionary<string, Factory> Providers = new(StringComparer.OrdinalIgnoreCase)
    {
        ["openai"] = (conn, system, tools, options) => new OpenAIChat(conn, system, tools, options),
    };

    public static IChat Create(JsonObject conn, string? system = null, IReadOnlyList<ToolSpec>? tools = null, JsonObject? options = null)
    {
        var provider = J.Str(conn, "provider", "openai");
        if (!Providers.TryGetValue(provider, out var factory))
        {
            if (provider.Equals("anthropic", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("Claude support is not part of this build. Export the project again from AIUI so AnthropicChat.cs is included.");
            factory = Providers["openai"];
        }
        return factory(conn, system ?? "", tools ?? [], options ?? new JsonObject());
    }
}

/// <summary>Any OpenAI-compatible endpoint: OpenAI, Ollama, LM Studio, vLLM, OpenRouter...</summary>
public sealed class OpenAIChat : IChat
{
    readonly JsonObject _conn;
    readonly JsonObject _options;
    readonly List<JsonObject> _messages = [];
    readonly JsonArray _tools = [];

    public OpenAIChat(JsonObject conn, string system, IReadOnlyList<ToolSpec> tools, JsonObject options)
    {
        _conn = conn;
        _options = options;
        if (system.Length > 0) _messages.Add(new JsonObject { ["role"] = "system", ["content"] = system });
        foreach (var tool in tools)
        {
            _tools.Add(new JsonObject
            {
                ["type"] = "function",
                ["function"] = new JsonObject
                {
                    ["name"] = tool.Name,
                    ["description"] = tool.Description,
                    ["parameters"] = tool.Parameters.DeepClone(),
                },
            });
        }
    }

    public void AddText(string role, string text) => _messages.Add(new JsonObject { ["role"] = role, ["content"] = text });

    public void AddToolResults(IReadOnlyList<ToolResult> results)
    {
        foreach (var result in results)
            _messages.Add(new JsonObject { ["role"] = "tool", ["tool_call_id"] = result.Id, ["content"] = result.Content });
    }

    public async Task<(string Text, List<ToolCall> Calls)> StepAsync()
    {
        var baseUrl = J.Str(_conn, "baseUrl", "https://api.openai.com/v1").TrimEnd('/');
        var messages = new JsonArray();
        foreach (var message in _messages) messages.Add(message.DeepClone());
        var payload = new JsonObject { ["model"] = J.Str(_conn, "model", "gpt-4o-mini"), ["messages"] = messages };
        if (_tools.Count > 0) payload["tools"] = _tools.DeepClone();
        if (_options["temperature"] is { } temperature && temperature.GetValueKind() == JsonValueKind.Number) payload["temperature"] = temperature.DeepClone();
        if (J.Num(_options, "max_tokens") > 0) payload["max_tokens"] = (int)J.Num(_options, "max_tokens");
        var headers = new JsonObject();
        var apiKey = J.Str(_conn, "apiKey");
        if (apiKey.Length > 0) headers["Authorization"] = "Bearer " + apiKey;

        var response = await Http.SendAsync("POST", baseUrl + "/chat/completions", headers, payload, 300);
        if (!response["ok"]!.GetValue<bool>())
        {
            var detail = J.Resolve("body.error.message", response) ?? J.Resolve("body.error", response) ?? response["body"];
            var text = J.Text(detail);
            throw new InvalidOperationException($"The AI service returned {response["status"]}: {(text.Length > 500 ? text[..500] : text)}");
        }
        var reply = J.Resolve("body.choices.0.message", response) as JsonObject
            ?? throw new InvalidOperationException("The AI service sent an unreadable reply.");
        _messages.Add((JsonObject)reply.DeepClone());
        var calls = new List<ToolCall>();
        if (reply["tool_calls"] is JsonArray toolCalls)
        {
            foreach (var call in toolCalls)
            {
                JsonObject arguments;
                try { arguments = JsonNode.Parse(J.Text(J.Resolve("function.arguments", call)) is { Length: > 0 } raw ? raw : "{}") as JsonObject ?? new JsonObject(); }
                catch (JsonException) { arguments = new JsonObject(); }
                calls.Add(new ToolCall(J.Text(call?["id"]), J.Text(J.Resolve("function.name", call)), arguments));
            }
        }
        return (J.Text(reply["content"]), calls);
    }
}

// ----------------------------------------------------------------------------
// MCP (Model Context Protocol) - streamable HTTP transport
// ----------------------------------------------------------------------------

public sealed class McpClient
{
    readonly string _url;
    readonly JsonObject _headers = new() { ["Accept"] = "application/json, text/event-stream" };
    int _id;
    bool _ready;

    public McpClient(JsonObject conn)
    {
        _url = J.Str(conn, "url");
        if (_url.Length == 0) throw new InvalidOperationException("The MCP connection has no URL.");
        var token = J.Str(conn, "token");
        if (token.Length > 0) _headers["Authorization"] = "Bearer " + token;
        if (conn["headers"] is JsonObject extra)
            foreach (var pair in extra) _headers[pair.Key] = J.Text(pair.Value);
    }

    async Task<JsonObject> SendAsync(string method, JsonObject? parameters = null, bool notification = false)
    {
        var payload = new JsonObject { ["jsonrpc"] = "2.0", ["method"] = method };
        if (parameters is not null) payload["params"] = parameters;
        var id = 0;
        if (!notification) payload["id"] = id = ++_id;
        var response = await Http.SendAsync("POST", _url, (JsonObject)_headers.DeepClone(), payload, 120);
        var session = J.Text(J.Resolve("headers.mcp-session-id", response));
        if (session.Length > 0) _headers["Mcp-Session-Id"] = session;
        if (notification) return new JsonObject();
        var text = J.Text(response["text"]);
        if (!response["ok"]!.GetValue<bool>())
            throw new InvalidOperationException($"MCP server returned {response["status"]}: {(text.Length > 300 ? text[..300] : text)}");
        var message = response["body"] as JsonObject;
        if (J.Text(J.Resolve("headers.content-type", response)).Contains("text/event-stream"))
        {
            message = null;
            foreach (var line in text.Split('\n'))
            {
                if (!line.StartsWith("data:")) continue;
                try
                {
                    if (JsonNode.Parse(line[5..].Trim()) is JsonObject candidate && candidate["id"] is { } candidateId
                        && candidateId.GetValueKind() == JsonValueKind.Number && candidateId.GetValue<int>() == id)
                        message = candidate;
                }
                catch (JsonException) { }
            }
        }
        if (message is null) throw new InvalidOperationException("MCP server sent no readable reply.");
        if (message["error"] is { } error) throw new InvalidOperationException("MCP error: " + J.Text((error as JsonObject)?["message"] ?? error));
        return message["result"] as JsonObject ?? new JsonObject();
    }

    async Task EnsureReadyAsync()
    {
        if (_ready) return;
        var result = await SendAsync("initialize", new JsonObject
        {
            ["protocolVersion"] = "2025-06-18",
            ["capabilities"] = new JsonObject(),
            ["clientInfo"] = new JsonObject { ["name"] = "aiui-runtime", ["version"] = "1.0" },
        });
        _headers["MCP-Protocol-Version"] = J.Str(result, "protocolVersion", "2025-06-18");
        await SendAsync("notifications/initialized", notification: true);
        _ready = true;
    }

    public async Task<JsonArray> ListToolsAsync()
    {
        await EnsureReadyAsync();
        return (await SendAsync("tools/list"))["tools"] as JsonArray ?? [];
    }

    public async Task<JsonObject> CallToolAsync(string name, JsonObject? arguments)
    {
        await EnsureReadyAsync();
        var result = await SendAsync("tools/call", new JsonObject { ["name"] = name, ["arguments"] = arguments?.DeepClone() ?? new JsonObject() });
        var parts = new List<string>();
        if (result["content"] is JsonArray content)
            foreach (var part in content)
                if (J.Text(part?["type"]) == "text") parts.Add(J.Text(part?["text"]));
        var text = string.Join("\n", parts);
        if (result["isError"] is { } flag && flag.GetValueKind() == JsonValueKind.True)
            throw new InvalidOperationException(text.Length > 0 ? text : "The MCP tool reported an error.");
        return new JsonObject
        {
            ["text"] = text,
            ["content"] = J.Clone(result["content"]) ?? new JsonArray(),
            ["data"] = J.Clone(result["structuredContent"]),
        };
    }
}

// ----------------------------------------------------------------------------
// Engine
// ----------------------------------------------------------------------------

/// <summary>What a step receives as ctx.</summary>
public sealed class StepContext(Workflow workflow, JsonObject node)
{
    public Workflow Workflow { get; } = workflow;
    public JsonObject Node { get; } = node;
    public string Name { get; } = J.Str(node, "name");
    public JsonObject Data => Workflow.Data;
    public JsonObject Vars => (JsonObject)Workflow.Data["vars"]!;
    internal string? SelectedPort { get; private set; }

    public void Log(string message, string level = "info") =>
        Workflow.Emit(new JsonObject { ["type"] = "log", ["level"] = level, ["message"] = message, ["nodeId"] = J.Str(Node, "id") });

    /// <summary>Choose which output port fires: return ctx.Branch("true", value);</summary>
    public JsonNode? Branch(string port, JsonNode? value = null)
    {
        SelectedPort = port;
        return value;
    }

    public JsonObject Connection(string? id, bool required = true)
    {
        if (string.IsNullOrEmpty(id))
        {
            if (required) throw new InvalidOperationException("No connection selected. Open the step and choose one.");
            return new JsonObject();
        }
        if (Workflow.Connections[id] is not JsonObject entry) throw new InvalidOperationException("The selected connection no longer exists.");
        return J.ExpandEnv(entry["values"]) as JsonObject ?? new JsonObject();
    }

    public Task<JsonObject> HttpAsync(string method, string url, JsonObject? headers = null, JsonNode? body = null, double timeoutSeconds = 60) =>
        Http.SendAsync(method, url, headers, body, timeoutSeconds);

    /// <summary>One question, one answer.</summary>
    public async Task<string> LlmChatAsync(JsonObject conn, string prompt, string? system = null, JsonNode? history = null, JsonObject? options = null)
    {
        var chat = Llm.Create(conn, system, null, options);
        AddHistory(chat, history);
        chat.AddText("user", prompt);
        var (text, _) = await chat.StepAsync();
        return text;
    }

    static void AddHistory(IChat chat, JsonNode? history)
    {
        if (history is not JsonArray turns) return;
        foreach (var turn in turns)
        {
            var role = J.Text(turn?["role"]);
            if (role is "user" or "assistant") chat.AddText(role, J.Text(turn?["content"]));
        }
    }

    public McpClient Mcp(JsonObject conn) => new(conn);

    /// <summary>Run everything linked from one of this step's ports, to completion. Used by loops.</summary>
    public Task<JsonNode?> RunPortAsync(string port, JsonObject? scope = null) =>
        Workflow.RunFromPortAsync(J.Str(Node, "id"), port, scope ?? new JsonObject());

    /// <summary>Tool-calling loop: the model may call linked steps and MCP tools until it answers.</summary>
    public async Task<JsonNode?> RunAgentAsync(JsonObject cfg)
    {
        var conn = Connection(J.Str(cfg, "connection"));
        var tools = new List<ToolSpec>();
        var handlers = new Dictionary<string, Func<JsonObject, Task<string>>>();

        foreach (var target in Workflow.Targets(J.Str(Node, "id"), "tools"))
        {
            var spec = target["tool"] as JsonObject ?? new JsonObject();
            var properties = new JsonObject();
            var required = new JsonArray();
            if (spec["params"] is JsonArray parameters)
            {
                foreach (var item in parameters)
                {
                    if (item is not JsonObject param) continue;
                    var paramName = J.Str(param, "name");
                    properties[paramName] = new JsonObject { ["type"] = J.Str(param, "type", "string"), ["description"] = J.Str(param, "description") };
                    if (J.Bool(param, "required", true)) required.Add(paramName);
                }
            }
            var toolName = J.Str(target, "name");
            var targetId = J.Str(target, "id");
            tools.Add(new ToolSpec(toolName, J.Str(spec, "description", $"Run the step {toolName}."),
                new JsonObject { ["type"] = "object", ["properties"] = properties, ["required"] = required }));
            handlers[toolName] = async args => J.Text(await Workflow.CallToolAsync(targetId, args));
        }

        var serverIds = cfg["mcpServers"] switch
        {
            JsonArray list => list.Select(J.Text).Where(s => s.Length > 0).ToList(),
            JsonNode single when J.Text(single).Length > 0 => [J.Text(single)],
            _ => new List<string>(),
        };
        foreach (var serverId in serverIds)
        {
            var client = new McpClient(Connection(serverId));
            foreach (var item in await client.ListToolsAsync())
            {
                if (item is not JsonObject tool) continue;
                var toolName = J.Str(tool, "name");
                var schema = tool["inputSchema"] as JsonObject ?? new JsonObject { ["type"] = "object", ["properties"] = new JsonObject() };
                tools.Add(new ToolSpec(toolName, J.Str(tool, "description"), (JsonObject)schema.DeepClone()));
                handlers[toolName] = async args => J.Text((await client.CallToolAsync(toolName, args))["text"]);
            }
        }

        var options = new JsonObject { ["temperature"] = J.Clone(cfg["temperature"]), ["max_tokens"] = J.Clone(cfg["maxTokens"]) };
        var chat = Llm.Create(conn, J.Str(cfg, "instructions"), tools, options);
        if (J.Bool(cfg, "useHistory", true)) AddHistory(chat, J.Resolve("input.history", Data));
        chat.AddText("user", J.Str(cfg, "prompt"));

        var trace = new JsonArray();
        var maxTurns = (int)J.Num(cfg, "maxTurns", 12);
        var text = "";
        for (var turn = 0; turn < maxTurns; turn++)
        {
            List<ToolCall> calls;
            (text, calls) = await chat.StepAsync();
            if (calls.Count == 0) return new JsonObject { ["text"] = text, ["toolCalls"] = trace };
            var results = new List<ToolResult>();
            foreach (var call in calls)
            {
                Log($"Tool call: {call.Name}({J.Json(call.Arguments)})");
                try
                {
                    if (!handlers.TryGetValue(call.Name, out var handler)) throw new InvalidOperationException($"Unknown tool {call.Name}");
                    var output = await handler(call.Arguments);
                    results.Add(new ToolResult(call.Id, output, false));
                    trace.Add(new JsonObject { ["tool"] = call.Name, ["arguments"] = call.Arguments.DeepClone(), ["result"] = output.Length > 2000 ? output[..2000] : output });
                }
                catch (Exception error) // the model sees the error and can recover
                {
                    results.Add(new ToolResult(call.Id, "Error: " + error.Message, true));
                    trace.Add(new JsonObject { ["tool"] = call.Name, ["arguments"] = call.Arguments.DeepClone(), ["error"] = error.Message });
                }
            }
            chat.AddToolResults(results);
        }
        return new JsonObject
        {
            ["text"] = text.Length > 0 ? text : "Stopped: the agent reached its turn limit.",
            ["toolCalls"] = trace,
            ["stopped"] = true,
        };
    }
}

public sealed class Workflow
{
    public const string EventPrefix = "@@AIUI ";
    const int MaxStepsPerRun = 10000;

    readonly Dictionary<string, JsonObject> _nodes = [];
    readonly List<JsonObject> _edges = [];
    readonly Dictionary<string, StepFunc> _steps;
    int _count;

    public JsonObject Data { get; private set; } = new();
    public JsonObject Connections { get; } = new();
    public bool Events { get; set; }
    public string BaseDir { get; }

    public Workflow(string definitionJson, Dictionary<string, StepFunc> steps, string? baseDir = null)
    {
        _steps = steps;
        BaseDir = baseDir ?? AppContext.BaseDirectory;
        var definition = JsonNode.Parse(definitionJson)!.AsObject();
        foreach (var node in definition["nodes"]!.AsArray()) _nodes[J.Text(node!["id"])] = node.AsObject();
        foreach (var edge in definition["edges"]!.AsArray()) _edges.Add(edge!.AsObject());
        LoadEnvFile(Path.Combine(BaseDir, ".env"));
        var path = Path.Combine(BaseDir, "connections.json");
        if (File.Exists(path)) Connections = JsonNode.Parse(File.ReadAllText(path))!.AsObject();
        ResetData(null);
    }

    static void LoadEnvFile(string path)
    {
        if (!File.Exists(path)) return;
        foreach (var raw in File.ReadAllLines(path))
        {
            var line = raw.Trim();
            var split = line.IndexOf('=');
            if (line.Length == 0 || line.StartsWith('#') || split < 1) continue;
            var key = line[..split].Trim();
            var value = line[(split + 1)..].Trim().Trim('"').Trim('\'');
            if (Environment.GetEnvironmentVariable(key) is null) Environment.SetEnvironmentVariable(key, value);
        }
    }

    void ResetData(JsonNode? input)
    {
        var env = new JsonObject();
        foreach (System.Collections.DictionaryEntry entry in Environment.GetEnvironmentVariables()) env[(string)entry.Key] = entry.Value as string;
        Data = new JsonObject { ["input"] = J.Clone(input) ?? new JsonObject(), ["vars"] = new JsonObject(), ["env"] = env };
    }

    // -- output ---------------------------------------------------------------

    public void Emit(JsonObject message)
    {
        if (Events)
        {
            Console.Out.WriteLine(EventPrefix + J.Json(message));
            Console.Out.Flush();
            return;
        }
        switch (J.Str(message, "type"))
        {
            case "node_start": Console.WriteLine($"[run]   {message["name"]}"); break;
            case "node_end": Console.WriteLine($"[ok]    {message["name"]} ({message["ms"]} ms)"); break;
            case "node_error": Console.WriteLine($"[error] {message["name"]}: {message["error"]}"); break;
            case "log": Console.WriteLine($"[{message["level"]}]  {message["message"]}"); break;
        }
    }

    static JsonNode? Preview(JsonNode? value)
    {
        var encoded = J.Json(value);
        if (encoded.Length <= 20000) return J.Clone(value);
        return new JsonObject { ["_truncated"] = true, ["preview"] = encoded[..4000] };
    }

    // -- graph ----------------------------------------------------------------

    public JsonObject Trigger() =>
        _nodes.Values.FirstOrDefault(n => J.Str(n, "kind") == "trigger")
        ?? throw new InvalidOperationException("This project has no trigger step.");

    /// <summary>The code behind a step type, or null when the project has none.</summary>
    public StepFunc? StepFor(string type) => _steps.TryGetValue(type, out var step) ? step : null;

    public List<JsonObject> Targets(string nodeId, string port) =>
        _edges.Where(e => J.Str(e, "source") == nodeId && J.Str(e, "sourcePort") == port && _nodes.ContainsKey(J.Str(e, "target")))
            .Select(e => _nodes[J.Str(e, "target")]).ToList();

    // -- execution ------------------------------------------------------------

    /// <summary>Run the whole workflow once. Returns the output of the last step that ran.</summary>
    public async Task<JsonNode?> RunAsync(JsonNode? input = null)
    {
        ResetData(input);
        _count = 0;
        var watch = Stopwatch.StartNew();
        JsonNode? output;
        try
        {
            output = await RunChainAsync([J.Str(Trigger(), "id")]);
        }
        catch (StepFailedException failure)
        {
            Emit(new JsonObject { ["type"] = "run_end", ["status"] = "error", ["error"] = failure.Message, ["ms"] = watch.ElapsedMilliseconds });
            throw;
        }
        Emit(new JsonObject { ["type"] = "run_end", ["status"] = "success", ["output"] = Preview(output), ["ms"] = watch.ElapsedMilliseconds });
        return output;
    }

    public async Task<JsonNode?> RunFromPortAsync(string nodeId, string port, JsonObject scope)
    {
        var saved = new Dictionary<string, JsonNode?>();
        foreach (var pair in scope)
        {
            saved[pair.Key] = J.Clone(Data[pair.Key]);
            Data[pair.Key] = J.Clone(pair.Value);
        }
        try
        {
            return await RunChainAsync(Targets(nodeId, port).Select(n => J.Str(n, "id")));
        }
        finally
        {
            foreach (var pair in saved) Data[pair.Key] = pair.Value;
        }
    }

    public async Task<JsonNode?> CallToolAsync(string nodeId, JsonObject? arguments)
    {
        var saved = J.Clone(Data["args"]);
        Data["args"] = arguments?.DeepClone() ?? new JsonObject();
        try
        {
            return await RunChainAsync([nodeId]);
        }
        finally
        {
            Data["args"] = saved;
        }
    }

    async Task<JsonNode?> RunChainAsync(IEnumerable<string> startIds)
    {
        var queue = new Queue<string>(startIds);
        JsonNode? last = null;
        while (queue.Count > 0)
        {
            var nodeId = queue.Dequeue();
            string port;
            (port, last) = await RunNodeAsync(_nodes[nodeId]);
            foreach (var target in Targets(nodeId, port)) queue.Enqueue(J.Str(target, "id"));
        }
        return last;
    }

    async Task<(string Port, JsonNode? Value)> RunNodeAsync(JsonObject node)
    {
        var id = J.Str(node, "id");
        var name = J.Str(node, "name");
        if (++_count > MaxStepsPerRun) throw new StepFailedException(name, "The run was stopped after too many steps (possible endless loop).");
        Emit(new JsonObject { ["type"] = "node_start", ["nodeId"] = id, ["name"] = name });
        var watch = Stopwatch.StartNew();
        var ctx = new StepContext(this, node);
        JsonNode? result;
        try
        {
            if (!_steps.TryGetValue(J.Str(node, "type"), out var step)) throw new InvalidOperationException($"No code for step type {node["type"]}.");
            var cfg = J.Render(node["config"], Data) as JsonObject ?? new JsonObject();
            result = await step(cfg, ctx);
        }
        catch (StepFailedException)
        {
            throw;
        }
        catch (Exception error)
        {
            var message = error.Message.Length > 0 ? error.Message : error.GetType().Name;
            Emit(new JsonObject { ["type"] = "node_error", ["nodeId"] = id, ["name"] = name, ["error"] = message });
            if (J.Str(node, "onError") != "continue") throw new StepFailedException(name, message);
            Data[name] = new JsonObject { ["error"] = message };
            return ("out", Data[name]);
        }
        var port = ctx.SelectedPort ?? "out";
        Data[name] = J.Clone(result);
        Emit(new JsonObject
        {
            ["type"] = "node_end", ["nodeId"] = id, ["name"] = name, ["port"] = port,
            ["output"] = Preview(Data[name]), ["ms"] = watch.ElapsedMilliseconds,
        });
        return (port, Data[name]);
    }
}

// ----------------------------------------------------------------------------
// Command line: how an exported project starts
// ----------------------------------------------------------------------------

public static class Cli
{
    /// <summary>
    /// Start the project the way its trigger asks for.
    ///   --once         run a single time and exit
    ///   --events       print machine-readable events instead of plain log lines
    ///   --input JSON   data for the trigger (or --input @file.json)
    /// </summary>
    public static async Task<int> RunAsync(Workflow workflow, string[] args)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        workflow.Events = args.Contains("--events");
        var once = args.Contains("--once");
        JsonNode? input = null;
        var at = Array.IndexOf(args, "--input");
        if (at >= 0 && at + 1 < args.Length)
        {
            var raw = args[at + 1];
            if (raw.StartsWith('@')) raw = File.ReadAllText(raw[1..]);
            input = JsonNode.Parse(raw);
        }
        var trigger = workflow.Trigger();
        var cfg = trigger["config"] as JsonObject ?? new JsonObject();
        var mode = J.Str(trigger, "type").Split('.')[^1];

        async Task<(JsonNode? Output, bool Ok)> RunOnce(JsonNode? data)
        {
            try
            {
                return (await workflow.RunAsync(data), true);
            }
            catch (StepFailedException failure)
            {
                if (!workflow.Events) Console.Error.WriteLine(failure.Message);
                return (null, false);
            }
        }

        // A trigger's step class may declare
        //   public static Task ListenAsync(JsonObject cfg, StepContext ctx, Func<JsonNode?, Task<(JsonNode? Output, bool Ok)>> handle)
        // to keep the project running and start the flow for each event it receives.
        var listen = once ? null : workflow.StepFor(J.Str(trigger, "type"))?.Method.DeclaringType
            ?.GetMethod("ListenAsync", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static);
        if (listen is not null)
        {
            Func<JsonNode?, Task<(JsonNode? Output, bool Ok)>> handle = RunOnce;
            try
            {
                var rendered = J.Render(cfg, workflow.Data) as JsonObject ?? new JsonObject();
                await (Task)listen.Invoke(null, [rendered, new StepContext(workflow, trigger), handle])!;
            }
            catch (InvalidOperationException error)
            {
                Console.Error.WriteLine(error.Message);
                return 1;
            }
            return 0;
        }

        if (once || mode is not ("schedule" or "webhook" or "chat"))
        {
            var (output, ok) = await RunOnce(input);
            if (ok && !workflow.Events && output is not null) Console.WriteLine(J.Text(output));
            return ok ? 0 : 1;
        }

        if (mode == "schedule")
        {
            var unit = J.Str(cfg, "unit", "minutes") switch { "seconds" => 1, "hours" => 3600, "days" => 86400, _ => 60 };
            var seconds = Math.Max(1, J.Num(cfg, "every", 60) * unit);
            Console.WriteLine($"Running every {seconds} seconds (Ctrl+C to stop)");
            while (true)
            {
                await RunOnce(input);
                await Task.Delay(TimeSpan.FromSeconds(seconds));
            }
        }

        if (mode == "webhook")
        {
            var port = (int)J.Num(cfg, "port", 8080);
            var path = J.Str(cfg, "path", "/webhook").TrimEnd('/');
            using var listener = new HttpListener();
            listener.Prefixes.Add($"http://localhost:{port}/");
            listener.Start();
            Console.WriteLine($"Listening on http://localhost:{port}{path}  (Ctrl+C to stop)");
            while (true)
            {
                var http = await listener.GetContextAsync();
                if (http.Request.Url!.AbsolutePath.TrimEnd('/') != path)
                {
                    http.Response.StatusCode = 404;
                    http.Response.Close();
                    continue;
                }
                using var reader = new StreamReader(http.Request.InputStream, Encoding.UTF8);
                var raw = await reader.ReadToEndAsync();
                var headers = new JsonObject();
                foreach (var key in http.Request.Headers.AllKeys) if (key is not null) headers[key] = http.Request.Headers[key];
                var query = new JsonObject();
                foreach (var key in http.Request.QueryString.AllKeys) if (key is not null) query[key] = http.Request.QueryString[key];
                var payload = new JsonObject
                {
                    ["method"] = http.Request.HttpMethod,
                    ["body"] = raw.Length > 0 ? J.ParseOrText(raw) : new JsonObject(),
                    ["headers"] = headers,
                    ["query"] = query,
                };
                var (output, ok) = await RunOnce(payload);
                var reply = ok
                    ? new JsonObject { ["ok"] = true, ["output"] = J.Clone(output) }
                    : new JsonObject { ["ok"] = false, ["error"] = "The workflow failed. See the server log." };
                var bytes = Encoding.UTF8.GetBytes(J.Json(reply));
                http.Response.StatusCode = ok ? 200 : 500;
                http.Response.ContentType = "application/json";
                await http.Response.OutputStream.WriteAsync(bytes);
                http.Response.Close();
            }
        }

        Console.WriteLine("Chat started. Type a message, or 'exit' to quit.");
        var history = new JsonArray();
        while (true)
        {
            Console.Write("you> ");
            var message = Console.ReadLine()?.Trim();
            if (message is null || message.ToLowerInvariant() is "exit" or "quit") break;
            if (message.Length == 0) continue;
            var (output, ok) = await RunOnce(new JsonObject { ["message"] = message, ["history"] = history.DeepClone() });
            if (!ok) continue;
            var reply = output is JsonObject obj && obj.ContainsKey("text") ? J.Text(obj["text"]) : J.Text(output);
            Console.WriteLine("ai> " + reply);
            history.Add(new JsonObject { ["role"] = "user", ["content"] = message });
            history.Add(new JsonObject { ["role"] = "assistant", ["content"] = reply });
        }
        return 0;
    }
}
