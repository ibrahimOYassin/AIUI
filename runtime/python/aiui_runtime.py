"""AIUI runtime - the engine shipped with every generated project.

It walks the workflow graph, resolves {{references}}, calls the step functions in
steps/, and provides the helpers steps rely on (HTTP, LLM chat, agents, MCP).
Standard library only. The `anthropic` package is imported lazily, and only when a
connection uses the Anthropic provider.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

EVENT_PREFIX = "@@AIUI "
MAX_STEPS_PER_RUN = 10000
_REF = re.compile(r"\{\{\s*([^{}]+?)\s*\}\}")


# ----------------------------------------------------------------------------
# References
# ----------------------------------------------------------------------------

def to_text(value):
    """How a value looks when placed inside text."""
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    return json.dumps(value, ensure_ascii=False, default=str)


def resolve_path(path, scope):
    """Look up `a.b.0.c` in the scope. A missing part gives None."""
    current = scope
    for part in path.strip().split("."):
        part = part.strip()
        if isinstance(current, dict):
            current = current.get(part)
        elif isinstance(current, (list, tuple)):
            try:
                current = current[int(part)]
            except (ValueError, IndexError):
                return None
        else:
            return None
    return current


def render(value, scope):
    """Replace {{references}} in strings, recursively through lists and dicts.

    A string that is exactly one reference keeps the referenced value's type.
    """
    if isinstance(value, str):
        whole = _REF.fullmatch(value.strip())
        if whole:
            return resolve_path(whole.group(1), scope)
        return _REF.sub(lambda m: to_text(resolve_path(m.group(1), scope)), value)
    if isinstance(value, list):
        return [render(v, scope) for v in value]
    if isinstance(value, dict):
        return {k: render(v, scope) for k, v in value.items()}
    return value


def load_env_file(path):
    """Read KEY=VALUE lines from a .env file without overriding real environment variables."""
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            val = val.strip().strip('"').strip("'")
            os.environ.setdefault(key.strip(), val)


def _expand_env(value):
    if isinstance(value, str):
        return re.sub(r"\$\{([A-Za-z0-9_]+)\}", lambda m: os.environ.get(m.group(1), ""), value)
    if isinstance(value, dict):
        return {k: _expand_env(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_expand_env(v) for v in value]
    return value


# ----------------------------------------------------------------------------
# HTTP
# ----------------------------------------------------------------------------

def http_request(method, url, headers=None, body=None, timeout=60):
    """Make an HTTP request. Never raises for 4xx/5xx; check result["ok"]."""
    headers = dict(headers or {})
    data = None
    if body is not None and body != "":
        if isinstance(body, (bytes, bytearray)):
            data = bytes(body)
        elif isinstance(body, str):
            data = body.encode("utf-8")
        else:
            data = json.dumps(body).encode("utf-8")
            if not any(k.lower() == "content-type" for k in headers):
                headers["Content-Type"] = "application/json"
    if not any(k.lower() == "user-agent" for k in headers):
        headers["User-Agent"] = "aiui-runtime/1.0"
    request = urllib.request.Request(url, data=data, method=method.upper(), headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read()
            status = response.status
            response_headers = {k.lower(): v for k, v in response.headers.items()}
    except urllib.error.HTTPError as error:
        raw = error.read()
        status = error.code
        response_headers = {k.lower(): v for k, v in error.headers.items()}
    except urllib.error.URLError as error:
        raise RuntimeError(f"Could not reach {url}: {error.reason}") from None
    text = raw.decode("utf-8", errors="replace")
    parsed = text
    if text.strip()[:1] in ("{", "["):
        try:
            parsed = json.loads(text)
        except ValueError:
            parsed = text
    return {"status": status, "ok": 200 <= status < 300, "headers": response_headers, "body": parsed, "text": text}


# ----------------------------------------------------------------------------
# LLM chat - one small adapter per provider, same interface
# ----------------------------------------------------------------------------

class _OpenAIChat:
    """Any OpenAI-compatible endpoint: OpenAI, Ollama, LM Studio, vLLM, OpenRouter..."""

    def __init__(self, conn, system, tools, options):
        self.conn = conn
        self.options = options
        self.messages = [{"role": "system", "content": system}] if system else []
        self.tools = [
            {"type": "function", "function": {"name": t["name"], "description": t["description"], "parameters": t["parameters"]}}
            for t in tools
        ]

    def add_text(self, role, text):
        self.messages.append({"role": role, "content": text})

    def add_tool_results(self, results):
        for call_id, content, _is_error in results:
            self.messages.append({"role": "tool", "tool_call_id": call_id, "content": content})

    def step(self):
        base = (self.conn.get("baseUrl") or "https://api.openai.com/v1").rstrip("/")
        payload = {"model": self.conn.get("model") or "gpt-4o-mini", "messages": self.messages}
        if self.tools:
            payload["tools"] = self.tools
        if self.options.get("temperature") is not None:
            payload["temperature"] = self.options["temperature"]
        if self.options.get("max_tokens"):
            payload["max_tokens"] = int(self.options["max_tokens"])
        headers = {}
        if self.conn.get("apiKey"):
            headers["Authorization"] = "Bearer " + self.conn["apiKey"]
        response = http_request("POST", base + "/chat/completions", headers, payload, timeout=300)
        if not response["ok"]:
            detail = response["body"]
            if isinstance(detail, dict):
                detail = (detail.get("error") or {}).get("message") if isinstance(detail.get("error"), dict) else detail.get("error", detail)
            raise RuntimeError(f"The AI service returned {response['status']}: {to_text(detail)[:500]}")
        message = response["body"]["choices"][0]["message"]
        self.messages.append(message)
        calls = []
        for call in message.get("tool_calls") or []:
            try:
                arguments = json.loads(call["function"].get("arguments") or "{}")
            except ValueError:
                arguments = {}
            calls.append({"id": call["id"], "name": call["function"]["name"], "arguments": arguments})
        return message.get("content") or "", calls


class _AnthropicChat:
    """Claude through the official Anthropic SDK (pip install anthropic)."""

    def __init__(self, conn, system, tools, options):
        try:
            import anthropic
        except ImportError:
            raise RuntimeError("This project uses a Claude connection. Install the SDK first: pip install anthropic") from None
        self._sdk = anthropic
        kwargs = {}
        if conn.get("apiKey"):
            kwargs["api_key"] = conn["apiKey"]
        if conn.get("baseUrl"):
            kwargs["base_url"] = conn["baseUrl"]
        self.client = anthropic.Anthropic(**kwargs)
        self.model = conn.get("model") or "claude-opus-5-5"
        self.system = system
        self.options = options
        self.messages = []
        self.tools = [{"name": t["name"], "description": t["description"], "input_schema": t["parameters"]} for t in tools]

    def add_text(self, role, text):
        self.messages.append({"role": role, "content": text})

    def add_tool_results(self, results):
        # All results for one assistant turn go back in a single user message.
        self.messages.append({
            "role": "user",
            "content": [
                {"type": "tool_result", "tool_use_id": call_id, "content": content, "is_error": is_error}
                for call_id, content, is_error in results
            ],
        })

    def step(self):
        sdk = self._sdk
        request = {"model": self.model, "max_tokens": int(self.options.get("max_tokens") or 16000), "messages": self.messages}
        if self.system:
            request["system"] = self.system
        if self.tools:
            request["tools"] = self.tools
        while True:
            try:
                response = self.client.messages.create(**request)
            except sdk.AuthenticationError:
                raise RuntimeError("Claude rejected the API key. Check the connection.") from None
            except sdk.NotFoundError:
                raise RuntimeError(f"Claude does not know the model '{self.model}'. Check the connection.") from None
            except sdk.RateLimitError:
                raise RuntimeError("Claude rate limit reached. Try again shortly.") from None
            except sdk.APIStatusError as error:
                raise RuntimeError(f"Claude returned {error.status_code}: {error.message}") from None
            except sdk.APIConnectionError:
                raise RuntimeError("Could not reach the Claude API. Check the network.") from None
            # Keep the full content (thinking blocks included) so the next request is valid.
            self.messages.append({"role": "assistant", "content": response.content})
            if response.stop_reason == "pause_turn":
                continue
            break
        if response.stop_reason == "refusal":
            details = getattr(response, "stop_details", None)
            category = getattr(details, "category", None)
            raise RuntimeError("Claude declined this request" + (f" ({category})" if category else "") + ".")
        text = "".join(block.text for block in response.content if block.type == "text")
        calls = [
            {"id": block.id, "name": block.name, "arguments": dict(block.input)}
            for block in response.content
            if block.type == "tool_use"
        ]
        if response.stop_reason == "max_tokens" and not calls:
            text += "\n[The reply was cut off at the token limit.]"
        return text, calls


def make_chat(conn, system=None, tools=None, options=None):
    provider = (conn.get("provider") or "openai").lower()
    adapter = _AnthropicChat if provider == "anthropic" else _OpenAIChat
    return adapter(conn, system or "", tools or [], options or {})


# ----------------------------------------------------------------------------
# MCP (Model Context Protocol) - streamable HTTP transport
# ----------------------------------------------------------------------------

class McpClient:
    def __init__(self, conn):
        self.url = conn.get("url") or ""
        if not self.url:
            raise RuntimeError("The MCP connection has no URL.")
        self.headers = {"Accept": "application/json, text/event-stream"}
        if conn.get("token"):
            self.headers["Authorization"] = "Bearer " + conn["token"]
        for key, val in (conn.get("headers") or {}).items():
            self.headers[key] = val
        self._id = 0
        self._ready = False

    def _send(self, method, params=None, notification=False):
        payload = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            payload["params"] = params
        if not notification:
            self._id += 1
            payload["id"] = self._id
        response = http_request("POST", self.url, self.headers, payload, timeout=120)
        session = response["headers"].get("mcp-session-id")
        if session:
            self.headers["Mcp-Session-Id"] = session
        if notification:
            return None
        if not response["ok"]:
            raise RuntimeError(f"MCP server returned {response['status']}: {response['text'][:300]}")
        message = response["body"]
        if "text/event-stream" in response["headers"].get("content-type", ""):
            message = None
            for line in response["text"].splitlines():
                if line.startswith("data:"):
                    try:
                        candidate = json.loads(line[5:].strip())
                    except ValueError:
                        continue
                    if isinstance(candidate, dict) and candidate.get("id") == payload["id"]:
                        message = candidate
            if message is None:
                raise RuntimeError("MCP server sent no reply.")
        if not isinstance(message, dict):
            raise RuntimeError("MCP server sent an unreadable reply.")
        if message.get("error"):
            raise RuntimeError("MCP error: " + to_text(message["error"].get("message", message["error"])))
        return message.get("result") or {}

    def _ensure_ready(self):
        if self._ready:
            return
        result = self._send("initialize", {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {"name": "aiui-runtime", "version": "1.0"},
        })
        self.headers["MCP-Protocol-Version"] = result.get("protocolVersion", "2025-06-18")
        self._send("notifications/initialized", notification=True)
        self._ready = True

    def list_tools(self):
        self._ensure_ready()
        return self._send("tools/list").get("tools", [])

    def call_tool(self, name, arguments):
        self._ensure_ready()
        result = self._send("tools/call", {"name": name, "arguments": arguments or {}})
        text = "\n".join(part.get("text", "") for part in result.get("content", []) if part.get("type") == "text")
        if result.get("isError"):
            raise RuntimeError(text or "The MCP tool reported an error.")
        return {"text": text, "content": result.get("content", []), "data": result.get("structuredContent")}


# ----------------------------------------------------------------------------
# Engine
# ----------------------------------------------------------------------------

class Branch:
    """Returned by a step to choose which output port fires."""

    def __init__(self, port, value=None):
        self.port = port
        self.value = value


class StepFailed(Exception):
    def __init__(self, node_name, message):
        super().__init__(f"Step '{node_name}' failed: {message}")
        self.node_name = node_name
        self.message = message


class StepContext:
    """What a step function receives as `ctx`."""

    def __init__(self, workflow, node):
        self.workflow = workflow
        self.node = node
        self.name = node["name"]
        self.data = workflow.data
        self.vars = workflow.data["vars"]

    def log(self, message, level="info"):
        self.workflow.emit({"type": "log", "level": level, "message": to_text(message), "nodeId": self.node["id"]})

    def branch(self, port, value=None):
        return Branch(port, value)

    def connection(self, conn_id, required=True):
        if not conn_id:
            if required:
                raise RuntimeError("No connection selected. Open the step and choose one.")
            return {}
        entry = self.workflow.connections.get(conn_id)
        if entry is None:
            raise RuntimeError("The selected connection no longer exists.")
        return _expand_env(entry.get("values", {}))

    def http(self, method, url, headers=None, body=None, timeout=60):
        return http_request(method, url, headers, body, timeout)

    def llm_chat(self, conn, prompt, system=None, history=None, options=None):
        """One question, one answer."""
        chat = make_chat(conn, system, None, options)
        for turn in history or []:
            if isinstance(turn, dict) and turn.get("role") in ("user", "assistant"):
                chat.add_text(turn["role"], to_text(turn.get("content")))
        chat.add_text("user", to_text(prompt))
        text, _ = chat.step()
        return text

    def mcp(self, conn):
        return McpClient(conn)

    def run_port(self, port, scope=None):
        """Run everything linked from one of this step's ports, to completion. Used by loops."""
        return self.workflow.run_from_port(self.node["id"], port, scope or {})

    def run_agent(self, cfg):
        """Tool-calling loop: the model may call linked steps and MCP tools until it answers."""
        conn = self.connection(cfg.get("connection"))
        tools, handlers = [], {}
        for target in self.workflow.targets(self.node["id"], "tools"):
            spec = target.get("tool") or {}
            properties, required = {}, []
            for param in spec.get("params") or []:
                properties[param["name"]] = {"type": param.get("type", "string"), "description": param.get("description", "")}
                if param.get("required", True):
                    required.append(param["name"])
            tools.append({
                "name": target["name"],
                "description": spec.get("description") or f"Run the step {target['name']}.",
                "parameters": {"type": "object", "properties": properties, "required": required},
            })
            handlers[target["name"]] = (lambda args, node_id=target["id"]: self.workflow.call_tool(node_id, args))
        server_ids = cfg.get("mcpServers") or []
        if isinstance(server_ids, str):
            server_ids = [server_ids]
        for conn_id in server_ids:
            client = McpClient(self.connection(conn_id))
            for tool in client.list_tools():
                tools.append({
                    "name": tool["name"],
                    "description": tool.get("description", ""),
                    "parameters": tool.get("inputSchema") or {"type": "object", "properties": {}},
                })
                handlers[tool["name"]] = (lambda args, c=client, n=tool["name"]: c.call_tool(n, args)["text"])

        options = {"temperature": cfg.get("temperature"), "max_tokens": cfg.get("maxTokens")}
        chat = make_chat(conn, to_text(cfg.get("instructions")), tools, options)
        if cfg.get("useHistory", True):
            history = resolve_path("input.history", self.data)
            for turn in history if isinstance(history, list) else []:
                if isinstance(turn, dict) and turn.get("role") in ("user", "assistant"):
                    chat.add_text(turn["role"], to_text(turn.get("content")))
        chat.add_text("user", to_text(cfg.get("prompt")))

        trace = []
        max_turns = int(cfg.get("maxTurns") or 12)
        text = ""
        for _ in range(max_turns):
            text, calls = chat.step()
            if not calls:
                return {"text": text, "toolCalls": trace}
            results = []
            for call in calls:
                self.log(f"Tool call: {call['name']}({json.dumps(call['arguments'], ensure_ascii=False)})")
                handler = handlers.get(call["name"])
                try:
                    if handler is None:
                        raise RuntimeError(f"Unknown tool {call['name']}")
                    output = to_text(handler(call["arguments"]))
                    results.append((call["id"], output, False))
                    trace.append({"tool": call["name"], "arguments": call["arguments"], "result": output[:2000]})
                except Exception as error:  # the model sees the error and can recover
                    results.append((call["id"], f"Error: {error}", True))
                    trace.append({"tool": call["name"], "arguments": call["arguments"], "error": str(error)})
            chat.add_tool_results(results)
        return {"text": text or "Stopped: the agent reached its turn limit.", "toolCalls": trace, "stopped": True}


class Workflow:
    def __init__(self, nodes, edges, steps, base_dir=None, events=False):
        self.nodes = {node["id"]: node for node in nodes}
        self.edges = edges
        self.steps = steps
        self.base_dir = base_dir or os.getcwd()
        self.events = events
        self.connections = {}
        self.data = {"input": {}, "vars": {}, "env": dict(os.environ)}
        self._count = 0
        load_env_file(os.path.join(self.base_dir, ".env"))
        self.data["env"] = dict(os.environ)
        path = os.path.join(self.base_dir, "connections.json")
        if os.path.exists(path):
            with open(path, encoding="utf-8") as handle:
                self.connections = json.load(handle)

    # -- output ---------------------------------------------------------------

    def emit(self, event):
        if self.events:
            sys.stdout.write(EVENT_PREFIX + json.dumps(event, ensure_ascii=False, default=str) + "\n")
            sys.stdout.flush()
            return
        kind = event["type"]
        if kind == "node_start":
            print(f"[run]   {event['name']}")
        elif kind == "node_end":
            print(f"[ok]    {event['name']} ({event['ms']} ms)")
        elif kind == "node_error":
            print(f"[error] {event['name']}: {event['error']}")
        elif kind == "log":
            print(f"[{event['level']}]  {event['message']}")
        sys.stdout.flush()

    @staticmethod
    def _preview(value):
        """Keep event payloads small."""
        try:
            encoded = json.dumps(value, ensure_ascii=False, default=str)
        except (TypeError, ValueError):
            return str(value)[:4000]
        if len(encoded) <= 20000:
            return value
        return {"_truncated": True, "preview": encoded[:4000]}

    # -- graph ----------------------------------------------------------------

    def trigger(self):
        for node in self.nodes.values():
            if node.get("kind") == "trigger":
                return node
        raise RuntimeError("This project has no trigger step.")

    def targets(self, node_id, port):
        return [self.nodes[e["target"]] for e in self.edges if e["source"] == node_id and e["sourcePort"] == port and e["target"] in self.nodes]

    # -- execution ------------------------------------------------------------

    def run(self, payload=None):
        """Run the whole workflow once. Returns the output of the last step that ran."""
        self.data["input"] = payload if payload is not None else {}
        self.data["vars"] = {}
        self._count = 0
        started = time.time()
        try:
            output = self._run_chain([self.trigger()["id"]])
        except StepFailed as failure:
            self.emit({"type": "run_end", "status": "error", "error": str(failure), "ms": int((time.time() - started) * 1000)})
            raise
        self.emit({"type": "run_end", "status": "success", "output": self._preview(output), "ms": int((time.time() - started) * 1000)})
        return output

    def run_from_port(self, node_id, port, scope):
        saved = {key: self.data.get(key) for key in scope}
        self.data.update(scope)
        try:
            return self._run_chain([node["id"] for node in self.targets(node_id, port)])
        finally:
            self.data.update(saved)

    def call_tool(self, node_id, arguments):
        saved = self.data.get("args")
        self.data["args"] = arguments or {}
        try:
            return self._run_chain([node_id])
        finally:
            self.data["args"] = saved

    def _run_chain(self, start_ids):
        queue = list(start_ids)
        last = None
        while queue:
            node_id = queue.pop(0)
            port, last = self._run_node(self.nodes[node_id])
            queue.extend(node["id"] for node in self.targets(node_id, port))
        return last

    def _run_node(self, node):
        self._count += 1
        if self._count > MAX_STEPS_PER_RUN:
            raise StepFailed(node["name"], "The run was stopped after too many steps (possible endless loop).")
        self.emit({"type": "node_start", "nodeId": node["id"], "name": node["name"]})
        started = time.time()
        try:
            step = self.steps.get(node["type"])
            if step is None:
                raise RuntimeError(f"No code for step type {node['type']}.")
            cfg = render(node.get("config") or {}, self.data)
            result = step(cfg, StepContext(self, node))
        except StepFailed:
            raise
        except Exception as error:
            message = str(error) or error.__class__.__name__
            self.emit({"type": "node_error", "nodeId": node["id"], "name": node["name"], "error": message})
            if node.get("onError") == "continue":
                self.data[node["name"]] = {"error": message}
                return "out", self.data[node["name"]]
            raise StepFailed(node["name"], message) from None
        port, value = (result.port, result.value) if isinstance(result, Branch) else ("out", result)
        self.data[node["name"]] = value
        self.emit({
            "type": "node_end", "nodeId": node["id"], "name": node["name"], "port": port,
            "output": self._preview(value), "ms": int((time.time() - started) * 1000),
        })
        return port, value


# ----------------------------------------------------------------------------
# Command line: how an exported project starts
# ----------------------------------------------------------------------------

def _read_input(argv):
    if "--input" in argv:
        raw = argv[argv.index("--input") + 1]
        if raw.startswith("@"):
            with open(raw[1:], encoding="utf-8") as handle:
                raw = handle.read()
        return json.loads(raw)
    return None


def _serve_webhook(workflow, port, path):
    from http.server import BaseHTTPRequestHandler, HTTPServer

    class Handler(BaseHTTPRequestHandler):
        def _handle(self):
            parsed = urllib.parse.urlparse(self.path)
            if parsed.path.rstrip("/") != path.rstrip("/"):
                self.send_error(404)
                return
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length).decode("utf-8", errors="replace") if length else ""
            try:
                body = json.loads(raw) if raw else {}
            except ValueError:
                body = raw
            payload = {
                "method": self.command, "body": body, "headers": dict(self.headers.items()),
                "query": {k: v[0] for k, v in urllib.parse.parse_qs(parsed.query).items()},
            }
            try:
                reply, status = {"ok": True, "output": workflow.run(payload)}, 200
            except StepFailed as failure:
                reply, status = {"ok": False, "error": str(failure)}, 500
            encoded = json.dumps(reply, ensure_ascii=False, default=str).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

        do_POST = _handle
        do_GET = _handle

        def log_message(self, *_args):
            pass

    print(f"Listening on http://localhost:{port}{path}  (Ctrl+C to stop)")
    HTTPServer(("0.0.0.0", port), Handler).serve_forever()


def _listener(workflow, trigger):
    """A trigger's step module may define listen(cfg, ctx, handle) to keep the project
    running and start the flow for each event it receives (a chat message, say).
    handle(payload) runs the flow once and returns (output, ok)."""
    step = workflow.steps.get(trigger["type"])
    module = sys.modules.get(getattr(step, "__module__", "") or "")
    return getattr(module, "listen", None)


def run_cli(workflow, argv=None):
    """Start the project the way its trigger asks for.

    --once         run a single time and exit (what the AIUI IDE uses)
    --events       print machine-readable events instead of plain log lines
    --input JSON   data for the trigger (or --input @file.json)
    """
    argv = list(sys.argv[1:] if argv is None else argv)
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass
    workflow.events = "--events" in argv
    once = "--once" in argv
    payload = _read_input(argv)
    trigger = workflow.trigger()
    cfg = trigger.get("config") or {}
    mode = trigger["type"].split(".")[-1]

    def run_once(data):
        try:
            return workflow.run(data), True
        except StepFailed as failure:
            if not workflow.events:
                print(str(failure), file=sys.stderr)
            return None, False

    listen = None if once else _listener(workflow, trigger)

    try:
        if listen is not None:
            try:
                listen(render(cfg, workflow.data), StepContext(workflow, trigger), run_once)
            except RuntimeError as error:
                print(str(error), file=sys.stderr)
                sys.exit(1)
            return
        if once or mode not in ("schedule", "webhook", "chat"):
            output, ok = run_once(payload)
            if ok and not workflow.events and output is not None:
                print(to_text(output))
            sys.exit(0 if ok else 1)
        if mode == "schedule":
            seconds = max(1.0, float(cfg.get("every") or 60) * {"seconds": 1, "minutes": 60, "hours": 3600, "days": 86400}.get(cfg.get("unit") or "minutes", 60))
            print(f"Running every {seconds:g} seconds (Ctrl+C to stop)")
            while True:
                run_once(payload)
                time.sleep(seconds)
        elif mode == "webhook":
            _serve_webhook(workflow, int(cfg.get("port") or 8080), cfg.get("path") or "/webhook")
        else:  # chat
            print("Chat started. Type a message, or 'exit' to quit.")
            history = []
            while True:
                try:
                    message = input("you> ").strip()
                except EOFError:
                    break
                if message.lower() in ("exit", "quit"):
                    break
                if not message:
                    continue
                output, ok = run_once({"message": message, "history": list(history)})
                if not ok:
                    continue
                reply = output.get("text") if isinstance(output, dict) and "text" in output else to_text(output)
                print("ai> " + to_text(reply))
                history.append({"role": "user", "content": message})
                history.append({"role": "assistant", "content": to_text(reply)})
    except KeyboardInterrupt:
        print("\nStopped.")
