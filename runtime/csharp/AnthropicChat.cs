// Claude through the official Anthropic SDK (NuGet package "Anthropic").
// AIUI adds this file only when a connection uses the Anthropic provider.

using System.Text.Json;
using System.Text.Json.Nodes;
using Anthropic;
using Anthropic.Exceptions;
using Anthropic.Models.Messages;

namespace Aiui.Runtime;

public sealed class AnthropicChat : IChat
{
    /// <summary>Called once from Program.cs.</summary>
    public static void Register() =>
        Llm.Providers["anthropic"] = (conn, system, tools, options) => new AnthropicChat(conn, system, tools, options);

    readonly IAnthropicClient _client;
    readonly string _model;
    readonly string _system;
    readonly long _maxTokens;
    readonly List<MessageParam> _messages = [];
    readonly List<ToolUnion> _tools = [];

    public AnthropicChat(JsonObject conn, string system, IReadOnlyList<ToolSpec> tools, JsonObject options)
    {
        var apiKey = J.Str(conn, "apiKey");
        var baseUrl = J.Str(conn, "baseUrl");
        // Without an explicit key the SDK reads ANTHROPIC_API_KEY from the environment.
        _client = new AnthropicClient();
        if (apiKey.Length > 0) _client = _client.WithOptions(o => o with { ApiKey = apiKey });
        if (baseUrl.Length > 0) _client = _client.WithOptions(o => o with { BaseUrl = baseUrl });
        _model = J.Str(conn, "model", "claude-opus-5-5");
        _system = system;
        _maxTokens = J.Num(options, "max_tokens") > 0 ? (long)J.Num(options, "max_tokens") : 16000;

        foreach (var tool in tools)
        {
            var properties = new Dictionary<string, JsonElement>();
            if (tool.Parameters["properties"] is JsonObject declared)
                foreach (var pair in declared) properties[pair.Key] = JsonSerializer.SerializeToElement(pair.Value);
            var required = new List<string>();
            if (tool.Parameters["required"] is JsonArray names)
                foreach (var name in names) required.Add(J.Text(name));
            _tools.Add(new Tool
            {
                Name = tool.Name,
                Description = tool.Description,
                InputSchema = new() { Properties = properties, Required = required },
            });
        }
    }

    public void AddText(string role, string text)
    {
        if (role == "assistant") _messages.Add(new AssistantMessageParam { Content = text });
        else _messages.Add(new UserMessageParam { Content = text });
    }

    public void AddToolResults(IReadOnlyList<ToolResult> results)
    {
        // All results for one assistant turn go back in a single user message.
        List<ContentBlockParam> blocks = [];
        foreach (var result in results)
            blocks.Add(new ToolResultBlockParam { ToolUseID = result.Id, Content = result.Content, IsError = result.IsError });
        _messages.Add(new UserMessageParam { Content = blocks });
    }

    public async Task<(string Text, List<ToolCall> Calls)> StepAsync()
    {
        while (true)
        {
            var parameters = new MessageCreateParams
            {
                Model = _model,
                MaxTokens = _maxTokens,
                Messages = _messages,
                Tools = _tools.Count > 0 ? _tools : null,
            };
            if (_system.Length > 0) parameters = parameters with { System = _system };

            Message response;
            try
            {
                response = await _client.Messages.Create(parameters);
            }
            catch (AnthropicUnauthorizedException)
            {
                throw new InvalidOperationException("Claude rejected the API key. Check the connection.");
            }
            catch (AnthropicNotFoundException)
            {
                throw new InvalidOperationException($"Claude does not know the model '{_model}'. Check the connection.");
            }
            catch (AnthropicRateLimitException)
            {
                throw new InvalidOperationException("Claude rate limit reached. Try again shortly.");
            }
            catch (AnthropicApiException error)
            {
                throw new InvalidOperationException("Claude returned an error: " + error.Message);
            }
            catch (AnthropicIOException)
            {
                throw new InvalidOperationException("Could not reach the Claude API. Check the network.");
            }

            // Echo the full content back (thinking blocks included) so the next request is valid.
            var text = new System.Text.StringBuilder();
            var calls = new List<ToolCall>();
            List<ContentBlockParam> echo = [];
            foreach (ContentBlock block in response.Content)
            {
                if (block.TryPickText(out TextBlock? textBlock))
                {
                    text.Append(textBlock.Text);
                    echo.Add(new TextBlockParam { Text = textBlock.Text });
                }
                else if (block.TryPickThinking(out ThinkingBlock? thinking))
                {
                    echo.Add(new ThinkingBlockParam { Thinking = thinking.Thinking, Signature = thinking.Signature });
                }
                else if (block.TryPickRedactedThinking(out RedactedThinkingBlock? redacted))
                {
                    echo.Add(new RedactedThinkingBlockParam { Data = redacted.Data });
                }
                else if (block.TryPickToolUse(out ToolUseBlock? toolUse))
                {
                    echo.Add(new ToolUseBlockParam { ID = toolUse.ID, Name = toolUse.Name, Input = toolUse.Input });
                    var arguments = JsonSerializer.SerializeToNode(toolUse.Input) as JsonObject ?? new JsonObject();
                    calls.Add(new ToolCall(toolUse.ID, toolUse.Name, arguments));
                }
            }
            if (echo.Count > 0) _messages.Add(new AssistantMessageParam { Content = echo });

            var stopReason = response.StopReason?.Raw() ?? "";
            if (stopReason == "pause_turn") continue;
            if (stopReason == "refusal")
            {
                var category = response.StopDetails?.Category?.Raw();
                throw new InvalidOperationException("Claude declined this request" + (string.IsNullOrEmpty(category) ? "" : $" ({category})") + ".");
            }
            if (stopReason == "max_tokens" && calls.Count == 0) text.Append("\n[The reply was cut off at the token limit.]");
            return (text.ToString(), calls);
        }
    }
}
