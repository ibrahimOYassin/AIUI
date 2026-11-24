# Running and developing AIUI

For people who host their own copy of AIUI or work on its code. If you only use the
website, see the [README](../README.md). The full design is in
[TECHNICAL_SPEC.md](TECHNICAL_SPEC.md).

## Requirements

- Node.js 23 or newer
- Python 3.10 or newer on your PATH (used by **Run** inside the IDE)
- .NET SDK 8 or newer — only to run exported C# projects

## Start

```bash
npm install
npm run build     # builds the web app
npm start         # http://localhost:4317
```

This is **local mode**: you are signed in automatically as the owner, and your data is
stored in `./data`.

To host it for several people, start it in **web mode**. Everyone registers an account and
sees only their own projects, connections and plugins:

```bash
npm run start:web
```

| Option | Environment variable | Default | Meaning |
|---|---|---|---|
| `--web` | `AIUI_MODE=web` | local | Accounts instead of automatic sign-in |
| `--port 8080` | `PORT` | 4317 | Port |
| `--data ./dir` | `AIUI_DATA_DIR` | `./data` | Database and secret key |
| | `AIUI_ALLOW_RUN` | on in local, off in web | Allow **Run** inside the IDE |
| | `AIUI_PYTHON` | `python` | Interpreter used by **Run** |

Options are passed after `--`, for example `npm start -- --port 8080`.

## Run with Docker

```bash
docker compose up -d --build     # then open http://localhost:4420
docker compose logs -f
docker compose down              # add -v to also delete your data
```

Two images are built: `aiui-api` (the server, with Python so **Run** works inside the IDE)
and `aiui-web` (nginx serving the app and forwarding `/api`). Your data is kept in the
`aiui-data` volume.

| Variable | Default | Meaning |
|---|---|---|
| `AIUI_WEB_PORT` | 4420 | Port of the app on your machine |
| `AIUI_API_PORT` | 4421 | Port of the API on your machine |
| `AIUI_MODE` | `local` | Set to `web` for accounts instead of automatic sign-in |
| `AIUI_ALLOW_RUN` | everyone in local, administrators in web | Who may **Run**; `true` = everyone, `false` = nobody |
| `AIUI_ADMIN_EMAIL`, `AIUI_ADMIN_PASSWORD` | | First administrator in web mode |
| `AIUI_CORS_ORIGINS` | | Origins allowed to call the API domain from a browser |
| `AIUI_BIND` | `127.0.0.1` | Address the ports are published on |
| `AIUI_SITE_URL` | `https://aiui.softera.site` | Your public address, used for search engines: canonical links, `sitemap.xml`, `robots.txt`, `llms.txt` and social cards. Set it before `docker compose build` |

Both ports are published on `127.0.0.1` only. Settings are read from a `.env` file next to
`docker-compose.yml`; copy `.env.example` to start.

### Putting it online

Set `AIUI_MODE=web` in `.env`. Then nobody can do anything without registering and signing
in, and an administrator account is created on first start from `AIUI_ADMIN_EMAIL` and
`AIUI_ADMIN_PASSWORD`. Point your reverse proxy or Cloudflare Tunnel at the two ports:

| Public address | Forward to | What it is |
|---|---|---|
| your app domain | `http://localhost:4420` | The IDE. It also serves the API under `/api`, so this alone is enough for the app |
| your API domain (optional) | `http://localhost:4421` | The API on its own, for direct use. List the app's origin in `AIUI_CORS_ORIGINS` if browsers will call it |

The administrator gets an **Admin** area: users (deactivate, sign in as, roles, password
reset), usage reports, the activity log, marketplace moderation and platform settings.

**Run** executes generated code inside the API container, so in web mode it is limited to
administrators until you change it in Admin → Settings.

Inside a container, `localhost` is the container itself. To use a model server running on
your machine (Ollama, LM Studio), enter `http://host.docker.internal:11434/v1` as the
connection address instead of `http://localhost:11434/v1`.

## Develop

```bash
npm run dev         # server on :4317 and Vite on :5173, both reloading
npm run typecheck
npm test            # server tests; generated Python projects are really executed
```

Slower checks are opt-in:

```bash
AIUI_TEST_DOTNET=1 npm test                          # also build and run generated C#
AIUI_TEST_PYTHON_ANTHROPIC=/path/to/python npm test  # also run the Claude SDK path against a mock
```

## Layout

| Path | Contents |
|---|---|
| `apps/web` | React IDE, marketplace and developer portal |
| `apps/server` | API, code generators, runner |
| `packages/shared` | Types shared by web and server — the API contract |
| `plugins/` | First-party plugins: `plugin.json` plus one `.py` and one `.cs` per step |
| `runtime/` | The engine copied into every generated project |
| `docs/` | Technical specification |

## Writing a plugin

A plugin is a JSON manifest: step definitions (label, icon, form fields, ports) with the
Python and C# source for each step. The quickest way to start is **Developer → New plugin →
Start from example** in the app. The step contract and field types are in §6 of the spec,
and `plugins/` holds nine complete examples.
