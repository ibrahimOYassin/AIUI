# AIUI — Technical Specification

**A no-code IDE for building AI workflows, AI agents and multi-agent solutions.**
Version 0.1 · 2026-11-21 · Status: implemented as MVP (see §14 for what is built vs. planned)

---

## 1. Product summary

AIUI is a visual IDE in which a user builds AI projects without writing code. The user
drags steps onto a canvas (or stacks them in a guided list), fills in forms, connects
LLMs and external systems, and presses **Run**. The IDE then generates a complete,
readable **Python** or **C#** project that the user can download and deploy anywhere.

Every capability of the IDE — triggers, actions, AI steps, connection types, templates —
is delivered as a **plugin**. Plugins are distributed through a built-in **marketplace**
where developers publish free or paid plugins. One account works in both the IDE and the
marketplace.

The IDE runs in two modes from the same codebase:

| Mode | How it starts | Access |
|---|---|---|
| **Local** | `npm start` on the user's machine | Single owner account, signed in automatically |
| **Web** | Same server deployed with `AIUI_MODE=web` | Register / sign in; every user sees only their own projects, connections and installs |

## 2. Requirements extracted from the brief

Each requirement has an ID that the rest of this document (and the code) refers to.

### 2.1 Stated requirements

| ID | Requirement | Source phrase |
|---|---|---|
| R1 | Full IDE that runs locally | "run locally" |
| R2 | The same IDE runs on the web with per-user access | "from web as user based access" |
| R3 | Build **workflow projects (Tasks)** in a GUI | "workflows projects (Tasks)" |
| R4 | Build **AI agents** in a GUI | "AI Agents" |
| R5 | Build **AI agent solutions** (several agents working together) | "AI Agents solutions" |
| R6 | No code: the user only supplies configuration | "without writing code" |
| R7 | LLM connections: local URL or hosted API with keys | "llm connections (local url or api with keys)" |
| R8 | Actions: send email | "send emails" |
| R9 | Actions: upload reports / files | "upload reports" |
| R10 | Actions: automate other applications through their APIs | "calling their API's" |
| R11 | Actions: automate other applications through MCP | "or MCPs" |
| R12 | Several UI modes; ease of use is the main design goal | "focus on the UI modes and user experience" |
| R13 | Features are split into plugins | "split the features as plugins" |
| R14 | Marketplace from which plugins are added | "from a market place" |
| R15 | One account for marketplace and IDE | "the user account will be the same" |
| R16 | Plugins are free or priced | "with price or free" |
| R17 | Plugins are created by developer accounts | "created by a developer account" |
| R18 | The IDE generates Python code | "generate python" |
| R19 | The IDE generates C# code | "C# codes" |
| R20 | Nobody can use the platform without registering and signing in (hosted install) | "no one can create project without register and login" |
| R21 | A default administrator account is created automatically | "seed a default admin account" |
| R22 | The administrator manages every user: deactivate, impersonate, roles, passwords, delete | "control all of the users (deactivate, impersonate and all of the management features)" |
| R23 | The administrator sees reports of who is using the platform | "view all of the reports of who is using the aiui platform" |

### 2.2 Enhancements added by this design

| ID | Enhancement | Why |
|---|---|---|
| E1 | **Run in the IDE** with live step highlighting, logs and per-step output | A no-code user must be able to test without leaving the IDE |
| E2 | **Chat test panel** for agent projects | Agents are conversational; a JSON input box is the wrong tool |
| E3 | **Variable picker** — insert the output of an earlier step with a click | Removes the need to learn the `{{step.field}}` syntax |
| E4 | **Problems panel** — live validation with click-to-fix | Catches missing fields before a run fails |
| E5 | **Templates** — start from a working example | Blank canvases are the hardest part of no-code tools |
| E6 | **Any step can be an agent tool**; an agent can be another agent's tool | One mechanism covers tools *and* multi-agent solutions (R5) |
| E7 | **Encrypted connection vault**; secrets never appear in generated code | Generated projects are shared and committed |
| E8 | **Declarative plugins** (data + code templates, no code executed inside the IDE) | Marketplace plugins cannot compromise the IDE server |
| E9 | Developer portal with manifest validation, versioning and earnings | Required to make R17 usable |
| E10 | Ratings and reviews; "official" badge | Trust signals for a marketplace |
| E11 | Light / dark theme, keyboard shortcuts, undo / redo, autosave | Baseline IDE ergonomics |
| E12 | Zero-dependency generated code by default (standard library only) | `python main.py` / `dotnet run` work immediately |

## 3. Core concepts

| Concept | Meaning |
|---|---|
| **Project** | One buildable unit. Type is `workflow`, `agent` or `solution`. All three share one graph model; the type selects templates and the default test panel. |
| **Step (node)** | One box on the canvas. Has a *type* (from a plugin), a unique *name* (`fetch_orders`) and a *config* (form values). |
| **Link (edge)** | Connects an output port of one step to the input of another. |
| **Trigger** | A step with no input that starts the flow: manual, schedule, webhook, chat message. |
| **Connection** | A saved, named set of credentials/settings (an LLM endpoint, an SMTP server, an API, an MCP server). Stored once, used by many steps. |
| **Plugin** | A package contributing step types, connection types and templates, including the Python and C# source for each step type. |
| **Listing** | A plugin's page in the marketplace: price, versions, reviews. |

### 3.1 Data passing

Every step produces one output value. Later steps read it with a reference:

```
{{fetch_orders.body.items}}     output of the step named fetch_orders
{{input.message}}               data the trigger received
{{vars.total}}                  a variable set by a "Set variables" step
{{item}} / {{index}}            current element inside a "For each" loop
{{args.city}}                   argument supplied by an agent calling this step as a tool
{{env.HOME}}                    environment variable
```

A field holding only one reference keeps the value's type (a list stays a list). A
reference inside longer text is converted to text. References are plain path lookups — there
is no expression language, which is what keeps Python and C# output identical in behaviour.
The UI inserts references through the variable picker (E3), so users never type them.

### 3.2 Control flow

Execution starts at a trigger and follows links. A step chooses which output port fires:

| Step | Ports |
|---|---|
| Ordinary step | `out` |
| Condition | `true`, `false` |
| For each | `item` (runs once per element, to completion), then `done` |
| AI Agent | `out`, plus the special `tools` port |

A step reached by two branches runs once per arrival. Each step has an *On error* setting:
stop the run (default) or continue.

### 3.3 Agents, tools and multi-agent solutions (R4, R5, E6)

The **AI Agent** step has a `tools` port. Any step linked from that port becomes a tool the
model may call. The tool's name is the step name; its description and parameters are entered
in the step's *Tool settings*. Inside the step, parameters are read as `{{args.<name>}}`.

Because an AI Agent step is itself a step, linking agent B from agent A's `tools` port makes
B a sub-agent of A. Supervisor/worker, router and pipeline patterns need nothing else.

An agent can also be given MCP server connections; every tool those servers expose is
offered to the model (R11).

## 4. Architecture

```
┌──────────────────────────── Browser ────────────────────────────┐
│  React SPA                                                       │
│  Home · IDE (Guided / Canvas / Code) · Connections ·             │
│  Marketplace · Developer portal · Account                        │
└───────────────────────────────┬──────────────────────────────────┘
                                │ REST + NDJSON stream  (/api)
┌───────────────────────────────┴──────────────────────────────────┐
│  AIUI server (Node.js, TypeScript, Express)                       │
│  auth │ projects │ connections vault │ catalog │ marketplace      │
│  developer portal │ validator │ code generators │ runner          │
└───────┬──────────────────────────────┬───────────────────────────┘
        │ SQLite (node:sqlite)          │ child process
   data/aiui.db                    generated Python project
                                   (events on stdout → UI)
```

| Layer | Technology | Reason |
|---|---|---|
| Web | React 19, Vite, TypeScript, React Flow (`@xyflow/react`), Zustand | Mature canvas library; small state footprint |
| Server | Node.js ≥ 23, Express 5, TypeScript via `tsx` | One language across web and server; shared types |
| Storage | SQLite through built-in `node:sqlite` | No native build step, no external database for local mode |
| Auth | scrypt password hashes, HMAC-SHA256 signed tokens (`node:crypto`) | No extra dependencies |
| Secrets | AES-256-GCM, key in `data/secret.key` or `AIUI_SECRET` | E7 |
| Generated code | Python ≥ 3.10 and .NET ≥ 8, standard library only | E12 |

Repository layout:

```
apps/server      API, code generators, runner
apps/web         React SPA
packages/shared  Types shared by web and server (the contract)
plugins/         First-party plugins: plugin.json + one .py and one .cs per step type
runtime/         The runtime copied into every generated project (python/, csharp/)
docs/            This document
```

## 5. Data model

| Table | Columns (main) |
|---|---|
| `users` | id, email (unique), name, password_hash, roles (JSON: `user`, `developer`, `admin`), developer_name, created_at |
| `projects` | id, owner_id, name, description, type, graph (JSON), settings (JSON), created_at, updated_at |
| `connections` | id, owner_id, name, type, values (JSON, non-secret), secrets (AES-GCM blob), created_at |
| `plugins` | id (e.g. `aiui.email`), developer_id, name, summary, description, category, icon, tags, price_cents, status (`draft`/`published`), official, downloads, created_at, updated_at |
| `plugin_versions` | plugin_id, version, manifest (JSON), changelog, created_at |
| `purchases` | id, user_id, plugin_id, price_cents, developer_cents, created_at |
| `installs` | user_id, plugin_id, version, enabled, created_at |
| `reviews` | user_id, plugin_id, rating (1–5), comment, created_at |

Graph JSON stored on a project:

```jsonc
{
  "nodes": [{
    "id": "n1", "type": "http.request", "name": "fetch_orders",
    "position": { "x": 320, "y": 120 },
    "config": { "method": "GET", "url": "https://api.example.com/orders" },
    "onError": "stop",
    "tool": { "description": "…", "params": [{ "name": "city", "type": "string", "description": "…" }] }
  }],
  "edges": [{ "id": "e1", "source": "n0", "sourcePort": "out", "target": "n1" }]
}
```

## 6. Plugin system (R13, E8)

A plugin is **data**: a manifest plus source templates. Nothing in a plugin executes inside
the IDE server or the browser; plugin code only runs inside the generated project.

```jsonc
{
  "id": "aiui.email", "name": "Email", "version": "1.0.0",
  "description": "Send email through any SMTP server.",
  "author": "AIUI", "icon": "mail", "category": "Communication",
  "connectionTypes": [{
    "type": "smtp", "label": "SMTP server", "icon": "mail",
    "fields": [
      { "key": "host", "label": "Host", "type": "text", "required": true },
      { "key": "password", "label": "Password", "type": "secret" }
    ]
  }],
  "nodes": [{
    "type": "email.send", "label": "Send email", "kind": "action",
    "category": "Communication", "icon": "mail",
    "description": "Send an email message.",
    "inputs": [{ "id": "in", "label": "In" }],
    "outputs": [{ "id": "out", "label": "Sent" }],
    "fields": [
      { "key": "connection", "label": "Mail server", "type": "connection", "connectionType": "smtp", "required": true },
      { "key": "to", "label": "To", "type": "text", "required": true, "templated": true }
    ],
    "outputFields": [{ "key": "sent", "label": "Sent" }],
    "codegen": {
      "python": { "source": "def run(cfg, ctx):\n    ...", "requirements": [] },
      "csharp": { "className": "EmailSendStep", "source": "public static class EmailSendStep { ... }", "packages": [] }
    }
  }],
  "templates": []
}
```

**Field types** drive the auto-generated forms: `text`, `textarea`, `number`, `boolean`,
`select`, `secret`, `connection`, `json`, `keyvalue`, `list`. Options: `required`,
`default`, `placeholder`, `help`, `options`, `connectionType`, `templated`, `showIf`,
`group` (`"Advanced"` collapses the field).

**Step contract**

| Language | Signature | Returns |
|---|---|---|
| Python | `def run(cfg: dict, ctx: StepContext)` | any JSON-serialisable value, or `ctx.branch("true", value)` to pick a port |
| C# | `public static async Task<JsonNode?> RunAsync(JsonObject cfg, StepContext ctx)` | same; `ctx.Branch("true", value)` |

`cfg` arrives with all references already resolved. `ctx` offers `connection(id)`, `log()`,
`http()`, `llm_chat()`, `run_agent()`, `mcp_call()`, variables and loop helpers.

**First-party plugins**

| Plugin | Steps | Installed |
|---|---|---|
| `aiui.core` | Manual / Schedule / Webhook / Chat triggers, Condition, For each, Set variables, Wait, Log | Always |
| `aiui.ai` | Ask AI (single prompt), AI Agent; `llm` and `mcp` connection types | Always |
| `aiui.http` | Call API; `http_api` connection type | Always |
| `aiui.email` | Send email; `smtp` connection type | Marketplace, free |
| `aiui.files` | Read file, Save file, Upload file (HTTP form upload or PUT/POST body) | Marketplace, free |
| `aiui.mcp` | Call MCP tool (uses the `mcp` connection type from `aiui.ai`) | Marketplace, free |
| `aiui.notify` | Post chat message (Slack / Teams / Discord); `chat_webhook` connection type | Marketplace, free |
| `aiui.data` | Compose text, Read JSON, Build CSV table | Marketplace, free |
| `aiui.reports` | Build report (Markdown / HTML) | Marketplace, **paid** (demonstrates R16) |

## 7. Marketplace (R14–R17)

| Flow | Behaviour |
|---|---|
| Browse | Search, category filter, free/paid filter, sort by popular / newest / rating |
| Listing page | Description, steps and connection types it adds, versions, reviews, price |
| Get (free) | Installs immediately |
| Buy (paid) | Checkout dialog → purchase recorded → install. **Payment is simulated in the MVP**; `purchases` is the integration point for a real provider (§14) |
| Manage | *My plugins*: enable / disable / uninstall / update |
| Become a developer | One click on the account page; adds the `developer` role and a display name |
| Publish | Developer portal: paste or upload a manifest → validation → set price → publish. A new manifest with a higher version adds a version |
| Earnings | Per-sale ledger; developer share 80 %, platform 20 % |
| Review | Users who installed a plugin can rate it 1–5 and comment |

Uninstalling a plugin never deletes project data. Steps whose plugin is missing show as
"Plugin not installed" with a link to the listing; validation reports them.

## 8. Code generation (R18, R19)

Generation is deterministic: the same project always yields the same files.

```
Python                                   C#
──────────────────────────────           ──────────────────────────────
main.py            entry point           Program.cs
workflow.py        steps + links         Workflow.cs
steps/<type>.py    one per step type     Steps/<Type>Step.cs
aiui_runtime.py    engine (static)       Runtime/AiuiRuntime.cs
connections.json   non-secret settings   connections.json
.env.example       secret placeholders   .env.example
requirements.txt                         <Name>.csproj
README.md                                README.md
```

- **Engine** — the runtime walks the graph, resolves references, calls step functions,
  handles branching, loops, errors, the agent tool loop and MCP calls. It is identical for
  every project; only `workflow.*` and `steps/*` differ.
- **Secrets** — `connections.json` contains `${ENV_VAR}` placeholders for secret fields;
  `.env.example` lists them. Real values are never written to disk by export. When running
  inside the IDE the server passes them to the child process as environment variables.
- **LLM providers** — `openai` (any OpenAI-compatible endpoint: OpenAI, Ollama, LM Studio,
  vLLM, OpenRouter, Azure OpenAI v1) uses `POST {baseUrl}/chat/completions` over plain HTTP.
  `anthropic` uses the official Anthropic SDK (`anthropic` / NuGet `Anthropic`), which is
  added to the project's dependencies only when such a connection is used. Default Claude
  model: `claude-opus-5-5`.
- **Triggers in exported code** — manual: run once; schedule: loop with sleep; webhook:
  built-in HTTP listener; chat: console chat loop.
- **Events** — with `--events` the runtime prints one JSON object per line (`node_start`,
  `node_end`, `node_error`, `log`, `run_end`). The IDE runner consumes exactly this stream.

## 9. Running inside the IDE (E1, E2)

`POST /api/projects/:id/run` generates the Python project into a temporary folder, starts
`python main.py --events --once`, and relays the event stream to the browser as NDJSON.
The canvas marks each step running / succeeded / failed; the console shows logs; clicking
a step shows its last output. Closing the stream stops the process. A run is limited by
`AIUI_RUN_TIMEOUT_MS` (default 120 s).

In web mode, running executes generated code on the server. It is enabled by default only
in local mode (`AIUI_ALLOW_RUN`); a hosted deployment must run it inside a sandbox (§14).

## 10. User experience (R12)

### 10.1 Three ways to look at the same project

| Mode | For | What it shows |
|---|---|---|
| **Guided** | First-time and non-technical users | The flow as a vertical list of numbered step cards: "When… → Then… → Then…". A **+** between cards adds a step. Branches are indented. No ports, no wires. |
| **Canvas** | Users building branching flows and agents | Free-form node graph with drag-and-drop from the step library, port-to-port linking, minimap, zoom, auto-layout. |
| **Code** | Developers and reviewers | Read-only generated project with a file tree, Python / C# switch, copy and download. |

Switching modes never changes the project. Guided is the default for new users; the choice
is remembered.

### 10.2 IDE layout

```
┌ top bar: project name · mode switch (Guided | Canvas | Code) · Problems · Run · Export ┐
├──────────┬──────────────────────────────────────────────┬──────────────────────────────┤
│ Step     │                                              │ Inspector                    │
│ library  │        Guided list  /  Canvas  /  Code        │  Settings · Tool · Output    │
│ (search, │                                              │  (form generated from the    │
│ grouped) │                                              │   step's field definitions)  │
├──────────┴──────────────────────────────────────────────┴──────────────────────────────┤
│ Bottom panel: Run log · Chat test · Problems                                           │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### 10.3 Ease-of-use rules

1. **No dead ends.** Every empty state says what to do next and offers a button that does it.
2. **Forms, not syntax.** Fields are generated from definitions; references come from the
   variable picker; conditions are *value – operator – value*.
3. **Connections in place.** A connection field has "New connection…" inline; the user never
   leaves the step to add an API key. Presets fill in provider URLs and model names.
4. **Errors where they happen.** A failed step turns red and shows its message; Problems
   entries select the offending step and focus the field.
5. **Safe by default.** Autosave, undo/redo, confirmation only for destructive actions.
6. **Start from something.** New project → pick a type → pick a template or blank.
7. **Friendly names.** "Call API", "Ask AI", "For each" — not `http.request`.

### 10.4 Screens

Home (projects, templates) · IDE · Connections · Marketplace (browse, listing, my plugins)
· Developer portal (my listings, publish, earnings) · Account · Sign in / Register (web mode).

## 11. API

All routes are under `/api`, JSON, authenticated with `Authorization: Bearer <token>`
except `config`, `auth/register`, `auth/login`, `auth/local`.

| Area | Routes |
|---|---|
| Config | `GET /config` |
| Auth | `POST /auth/register`, `POST /auth/login`, `POST /auth/local`, `GET /auth/me`, `PATCH /auth/me` |
| Catalog | `GET /catalog` — step types, connection types and templates from the user's enabled plugins |
| Projects | `GET/POST /projects`, `GET/PUT/DELETE /projects/:id`, `POST /projects/:id/duplicate` |
| Build | `POST /projects/:id/validate`, `POST /projects/:id/generate`, `GET /projects/:id/export?language=`, `POST /projects/:id/run` |
| Connections | `GET/POST /connections`, `PUT/DELETE /connections/:id`, `POST /connections/:id/test` |
| Marketplace | `GET /market/plugins`, `GET /market/plugins/:id`, `POST /market/plugins/:id/purchase`, `POST/DELETE /market/plugins/:id/install`, `POST /market/plugins/:id/reviews`, `GET /market/installed`, `PATCH /market/installed/:id` |
| Developer | `GET/POST /dev/plugins`, `PUT/DELETE /dev/plugins/:id`, `POST /dev/plugins/:id/publish`, `POST /dev/plugins/:id/unpublish`, `POST /dev/validate`, `GET /dev/earnings` |

Request and response shapes are the TypeScript types in `packages/shared/src/index.ts`,
which is the single source of truth for the contract.

## 11a. Administration (R20–R23)

**Accounts.** In web mode every route except `config`, `auth/register` and `auth/login`
needs a valid session. On first start the server creates an administrator from
`AIUI_ADMIN_EMAIL` / `AIUI_ADMIN_PASSWORD`; without a password it generates one and writes it
to `<data>/admin-password.txt`. If the database was previously used in local mode, that owner
account becomes the administrator so its projects are kept. Registering never grants the
`admin` role; only an administrator can.

| Area | What the administrator can do |
|---|---|
| Users | Search and filter; create; edit name, email, developer name; grant or remove Developer / Admin; deactivate and reactivate; reset password (ends that person's sessions); delete; export the list as CSV |
| Sign in as a user | A one-hour session as that person, for support. A banner shows it throughout the app; "Return to admin" ends it. Other administrators cannot be impersonated, the session has no admin rights, and it ends if the administrator behind it is deactivated or demoted |
| Reports | People: total, active today / 7 days / 30 days, new in period. Usage: projects, runs and failed runs, exports by language, plugin installs, purchases and revenue. A daily series, projects by type, top plugins and the most active people |
| Activity log | Every sign-in (and failed sign-in), project created / run / exported / deleted, connection added, plugin installed / bought / published, and every admin action — filterable by person and kind. Actions taken while impersonating are recorded under the user with the administrator named |
| Marketplace | See every plugin with developer and sales; publish / unpublish; mark official; delete unsold third-party plugins |
| Settings | Open or close sign-ups; who may press Run: nobody, administrators only (default in web mode), everyone |
| AI Assistant | Turn it on; choose Claude or an OpenAI-compatible server, the model, base URL and API key (stored encrypted, never returned); test it; name and greeting; extra instructions and extra knowledge (Markdown); signed-in people only or guests too; questions per person per day |

Safeguards: an administrator cannot deactivate, demote or delete themselves, and the last
administrator who can sign in cannot be removed. A deactivated account is rejected at sign-in
and on every request, so existing sessions stop at once. Accounts with purchases or published
plugins are deactivated rather than deleted, so sales records survive.

Data behind the reports: `events` (who, when, what, optional impersonator), `activity_days`
(one row per person per day they used the platform), `users.last_seen_at`.

Routes: `POST /auth/password`; `GET/POST /admin/users`, `GET/PATCH/DELETE /admin/users/:id`,
`POST /admin/users/:id/password`, `POST /admin/users/:id/impersonate`;
`GET /admin/reports/overview`, `GET /admin/reports/activity`; `GET /admin/plugins`,
`PATCH/DELETE /admin/plugins/:id`; `GET/PUT /admin/settings`; `GET/PUT /admin/assistant`,
`POST /admin/assistant/test`.

### 11b. AI Assistant

A chat panel next to every page (`POST /assistant/chat`, NDJSON stream of `text`, `tool`,
`done` and `error` events). The server runs the model loop itself, with read-only tools that
always act as the person asking: `search_docs` (keyword search over the Docs page as
Markdown — `docs/APP_GUIDE.md`, written by the web build from `Docs.tsx` —, README.md, the other
docs/*.md, every published Marketplace plugin and the administrator's extra knowledge, split at
headings), `list_steps`, `get_step`,
`list_templates`, and for signed-in people `list_my_projects`, `get_project` (steps,
settings with secrets hidden, links and validation problems) and `list_my_connections`
(no secret values). Every project and connection query filters on the person's own id, so
the model cannot reach anyone else's data whatever it asks for; guests get the documentation
tools only. The browser keeps the conversation (localStorage, per account) and sends its
text turns with each question; the server keeps the last 20. Each question is logged as an
`assistant.ask` event (without its text), which also enforces the daily limit; guests are
counted per address.

Claude goes through the Anthropic SDK with the stable instructions cached and, on the
Claude API, the server-side refusal fallback; other providers use the OpenAI chat
completions API with function calling, streamed or not. By default the assistant uses
Ollama's `lfm3` (`AIUI_ASSISTANT_PROVIDER`, `AIUI_ASSISTANT_BASE_URL` and `AIUI_ASSISTANT_MODEL`
set the starting values). Small local models often run with a 4,096-token context, so with an
OpenAI-compatible provider lookups return less (two sections of 1,500 characters per search,
6,000 characters per tool result), repeated searches are refused, and after three rounds of
lookups the model is asked to answer without tools.

## 12. Security

| Topic | Design |
|---|---|
| Passwords | scrypt with per-user salt; constant-time comparison |
| Sessions | Signed token, 30-day expiry, sent as Bearer header (no cookies → no CSRF surface). Changing or resetting a password invalidates older tokens |
| Sign-in abuse | Failed sign-ins are limited per account and per address; sign-ups per address |
| Cross-origin | The API answers browsers only from origins listed in `AIUI_CORS_ORIGINS` |
| Outbound checks | In web mode, only administrators can test a connection that points at a private or local address |
| Isolation | Every query is scoped by `owner_id` / `user_id`; ids are random UUIDs |
| Secrets | AES-256-GCM at rest; the API never returns secret values, only which are set |
| Plugins | Declarative; manifests are validated (ids, field types, both languages present, size limit); step source never executes in the server process |
| Generated code | No secrets embedded; placeholders resolved from the environment |
| Running code | Everyone in local mode; administrators only by default in web mode (Admin → Settings). Time-limited child process in a temp folder |
| Paid plugins | Manifest (including step source) is served only to users with a purchase |

## 13. Configuration

| Variable | Option | Default | Meaning |
|---|---|---|---|
| `AIUI_MODE` | `--web` | `local` | `local` (auto sign-in) or `web` (accounts) |
| `PORT` | `--port N` | `4317` | Server port |
| `AIUI_DATA_DIR` | `--data DIR` | `./data` | Database, secret key |
| `AIUI_SECRET` | | generated | Master key for tokens and the vault |
| `AIUI_ALLOW_RUN` | | everyone in local, admins in web | Starting value of "who may run"; `true` = everyone, `false` = nobody |
| `AIUI_ADMIN_EMAIL` / `AIUI_ADMIN_PASSWORD` / `AIUI_ADMIN_NAME` | | `admin@aiui.local` / generated / Administrator | First administrator (web mode) |
| `AIUI_CORS_ORIGINS` | | none | Web origins allowed to call the API directly |
| `AIUI_RUN_TIMEOUT_MS` | | `120000` | Run time limit |
| `AIUI_PYTHON` | | `python` | Interpreter used by the runner |

## 14. Delivery status and roadmap

**Built in the MVP (this repository)**

- R1–R19 end to end, with the limits below.
- E1–E12.

**Known limits of the MVP**

| Area | Limit | Next step |
|---|---|---|
| Payments (R16) | Checkout is simulated; no money moves | Integrate a payment provider at `purchases`; add payouts |
| Local packaging (R1) | Runs as a local web server opened in the browser | Wrap in a desktop shell (Tauri/Electron) |
| Marketplace location | Hosted by the same server as the IDE | Central marketplace service; local IDEs sign in to it |
| Run sandbox | Child process without isolation | Container / microVM per run for hosted deployments |
| Solutions (R5) | One graph per project | Multiple flows per solution, calling each other |
| Guided mode | Edits linear flows and one level of branches; deeper graphs open in Canvas | Full tree editing |
| Triggers in the IDE | Schedule and webhook run once with test data | Hosted scheduler and public webhook URLs |
| Collaboration | Single owner per project | Teams, sharing, roles per project |
| Plugin review | Published immediately | Review queue, automated scanning of step source |
| Outbound requests | "Test connection" is limited to public addresses for non-admins, but a run can still call any address the API container can reach — which is why Run defaults to administrators only | Sandbox network per run before opening Run to everyone |
| Accounts | No email verification or self-service password reset (an administrator resets passwords) | Email delivery for verification and reset links |
| MCP transport (R11) | Streamable HTTP only | stdio servers, OAuth sign-in |
| Claude refusals | A refusal stops the step with a clear message; server-side model fallback is not enabled because the model is user-chosen | Opt-in fallback per connection |
| Email in C# | `System.Net.Mail` supports STARTTLS, not implicit SSL on port 465 | MailKit as an optional package |
| Web bundle | Single 1.3 MB script (the full icon set is bundled so plugins can name any icon) | Load icons on demand |
| AI assistance | — | "Describe it and I'll build it" flow generator |
| Languages | Python, C# | TypeScript, Java generators (the plugin `codegen` map is open-ended) |

## 15. Verification

| What | How it is checked |
|---|---|
| Plugin manifests | Every first-party manifest is validated at start-up and in `npm test` |
| Python generation | `npm test` generates a project with references, variables, a loop and a condition, executes it, and compares the events; all 22 step modules are byte-compiled |
| C# generation | `AIUI_TEST_DOTNET=1 npm test` builds one project containing every step class and runs the same flow, expecting identical events |
| Secrets | Tests assert that no secret value appears in any generated file or API response |
| API | `npm test` starts the server in web mode on a temporary database and exercises accounts, per-user isolation, projects, the vault, generate / export / run, the marketplace and the developer portal |
| Agents and tools | The same suite runs an agent that calls a linked step as a tool, against a mock OpenAI-compatible endpoint and (opt-in) against a mock Anthropic endpoint through the official SDK |
| Third-party plugins | The suite publishes a paid plugin as one user, buys and installs it as another, runs its step, and checks the 80 % developer share |

Not covered by automated tests: the React UI (checked by hand), real LLM providers (only
mocks were available), SMTP delivery, and chat webhooks.
