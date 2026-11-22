// For each - runs the steps on the "item" path once per element, then continues on "done".
using System.Text.Json;
using System.Text.Json.Nodes;
using Aiui.Runtime;

namespace Aiui.Steps;

public static class LogicLoopStep
{
    public static async Task<JsonNode?> RunAsync(JsonObject cfg, StepContext ctx)
    {
        var items = cfg["items"];
        if (items is not null && items.GetValueKind() == JsonValueKind.String) items = J.ParseOrText(items.GetValue<string>());
        items ??= new JsonArray();
        if (items is not JsonArray list) throw new InvalidOperationException("\"List to go through\" must be a list.");
        var limit = (int)J.Num(cfg, "maxItems");
        var results = new JsonArray();
        var index = 0;
        foreach (var item in list.ToList())
        {
            if (limit > 0 && index >= limit) break;
            var output = await ctx.RunPortAsync("item", new JsonObject { ["item"] = J.Clone(item), ["index"] = index });
            results.Add(J.Clone(output));
            index++;
        }
        return ctx.Branch("done", new JsonObject { ["count"] = index, ["results"] = results });
    }
}
