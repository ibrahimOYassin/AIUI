<img src="assets/logo.svg" width="88" alt="AIUI logo">

# AIUI

Build AI workflows, AI agents and teams of agents in your browser — without writing code.

You put steps together, fill in forms, connect an AI model, and test the result. When it
works, you download it as a complete **Python** or **C#** project that runs anywhere.

**Open the app: https://aiui.softera.site**

## Contents

- [Get started](#get-started)
- [Your first project](#your-first-project)
- [The three views](#the-three-views)
- [Working with steps](#working-with-steps)
- [Connections: AI models and other services](#connections-ai-models-and-other-services)
- [AI agents and teams of agents](#ai-agents-and-teams-of-agents)
- [Testing your project](#testing-your-project)
- [Downloading your project as code](#downloading-your-project-as-code)
- [Marketplace: adding more steps](#marketplace-adding-more-steps)
- [Publishing your own plugins](#publishing-your-own-plugins)
- [Your account](#your-account)
- [Common questions](#common-questions)

## Get started

1. Go to https://aiui.softera.site and choose **Create an account**.
2. Enter your name, email and a password of at least 8 characters.
3. You land on **Home**, where your projects live.

You need an account to do anything; everything you build is private to you.

## Your first project

On **Home**, choose **New project** and pick what you want to build:

| Type | Use it for |
|---|---|
| **Workflow** | A task that runs step by step: fetch data, process it, send a result |
| **AI Agent** | An AI that works towards a goal and decides which tools to use |
| **Agent Solution** | Several agents working together, such as a lead with helpers |

Then start from a template or a blank page. If you are new, start with the template
**Fetch and process a list**: it needs no keys or setup and shows the basics.

| Template | What it shows |
|---|---|
| Fetch and process a list | Calling an API and going through the results one by one |
| Summarise data with AI | Sending data to an AI model and using its answer |
| Agent with a tool | A chat agent that looks something up when asked |
| Team of agents | A lead agent handing work to a researcher and a writer |

## The three views

Every project can be seen in three ways. Switch between them at the top of the screen;
switching never changes your project.

| View | Best for | What you see |
|---|---|---|
| **Guided** | Getting started | Your flow as a numbered list: "When… then… then…". Press **+** to add a step |
| **Canvas** | Branching flows and agents | Steps as boxes you drag around and link together |
| **Code** | Seeing what you built | The generated Python or C# project, read-only |

## Working with steps

A project is made of **steps**. The first step decides how the project starts; the rest do
the work.

**Add a step.** Pick it from the **Step library** on the left, or press **+** in the Guided
view. Press **Ctrl + K** to add a step by typing its name.

**Set it up.** Select a step to open its settings on the right. Fields marked as required
must be filled in.

**Use the result of an earlier step.** Press **Insert data** next to a field and pick what
you need, for example the answer from an AI step or one item from a list. You never have to
type the reference yourself.

**Fix problems.** The **Problems** counter at the top shows what is missing. Select a
problem to jump to the step and field that needs attention.

**Undo.** **Ctrl + Z** undoes any change; **Ctrl + Shift + Z** redoes it. Your work is saved
automatically.

Steps available to every account:

| Group | Steps |
|---|---|
| Start | Run manually · On a schedule · When a webhook is called · When a chat message arrives |
| Logic | Condition · For each · Set variables · Wait · Log message |
| AI | Ask AI · AI Agent |
| Integrations | Call API |

More steps — email, files and uploads, chat alerts, data tools, reports, MCP tools — come
from the [Marketplace](#marketplace-adding-more-steps).

## Connections: AI models and other services

A **connection** stores the address and key of a service once, so any step can use it.
Keys are stored encrypted and are never shown again after you save them.

Create one on the **Connections** page, or directly from a step by choosing
**New connection…** in its connection field.

**AI model.** Choose a preset and paste your API key:

| Preset | You need |
|---|---|
| Claude | An Anthropic API key |
| OpenAI | An OpenAI API key |
| OpenRouter | An OpenRouter API key and a model name |
| Ollama / LM Studio | A model server address (see the note below) |

**Other services.** API accounts, mail servers, chat channels and MCP servers work the same
way; which ones you see depends on the plugins you have installed.

Use **Test** to check a connection before relying on it.

> **Models on your own computer.** The website cannot reach a model server on your machine
> (such as Ollama at `localhost`), because that address means something different on the
> server. Build your project here, then [download it](#downloading-your-project-as-code)
> and run it on your own computer, where your local model is reachable.

## AI agents and teams of agents

An **AI Agent** step is given a role, a task, and tools it may use.

**Give an agent a tool.** In the Canvas view, drag a link from the agent's **Tools** port
to any other step. That step is now a tool. Open it and fill in **Tool settings**:

- **Description** — when the agent should use it. Be specific; the agent reads this.
- **Parameters** — what the agent must supply, for example `city`. Use them in the step's
  fields through **Insert data**.

**Build a team.** Link another AI Agent from the Tools port. The first agent can now hand
work to the second, which may have tools of its own. The **Team of agents** template shows
a complete example.

**MCP servers.** An agent can also use every tool offered by an MCP server: add an MCP
server connection and tick it in the agent's settings.

## Testing your project

Press **Run** at the top. Each step lights up as it runs, the **Run log** fills in, and
selecting a step shows what it produced. A failed step turns red and shows why.

Projects that start with a chat message get a **Chat** panel instead, so you can talk to
your agent directly.

> **Run may be turned off for your account.** Running executes your project on the
> server, so the site's administrator decides who may use it. If Run is unavailable,
> download your project and run it on your own computer — it behaves the same.

## Downloading your project as code

Choose **Export** and pick **Python** or **C#**. You get a zip with a complete project and
its own instructions.

**Python** (3.10 or newer):

```bash
python main.py
```

**C#** (.NET SDK 8 or newer):

```bash
dotnet run
```

Good to know:

- Your keys are **not** in the download. The project lists the keys it needs in
  `.env.example`; copy it to `.env` and fill them in.
- Projects that use a Claude connection need one package first: `pip install -r requirements.txt`.
  Everything else runs with no installation.
- The project starts the way its first step says: a schedule keeps repeating, a webhook
  listens for calls, a chat opens a conversation in the terminal.
- To change the project, edit it on the website and export again.

## Marketplace: adding more steps

The **Marketplace** has plugins that add steps, connection types and templates.

| Plugin | Adds | Price |
|---|---|---|
| Email | Send email through any mail server | Free |
| Files & Uploads | Read, save and upload files and reports | Free |
| MCP Tools | Call a tool on an MCP server as a step | Free |
| Team Chat Alerts | Post to Slack, Microsoft Teams or Discord | Free |
| Data Tools | Compose text, read JSON, build CSV tables | Free |
| Report Builder Pro | Finished Markdown and HTML reports | Paid |

Choose **Get** to install a free plugin; its steps appear in your Step library at once.
Under **My plugins** you can turn plugins off or remove them. Removing a plugin never
deletes your projects — steps that need it simply ask you to install it again.

> Paid plugins currently use a demonstration checkout: no payment is taken.

## Publishing your own plugins

Anyone can publish plugins for others to use.

1. Open **Developer** and choose **Become a developer**.
2. Choose **New plugin**, then **Start from example** to load a small working plugin.
3. Adjust it, press **Validate**, set a price or leave it free, and **Publish**.

The Developer page shows your installs and earnings. Writing a plugin does require code:
each step needs a Python and a C# version.

## Your account

On the **Account** page you can change your name and password. The moon icon switches
between light and dark.

**Forgot your password?** There is no reset email yet. Ask the site's administrator to set
a new password for you.

## Common questions

**Do I need to know how to code?**
No. You only write code if you want to publish your own plugins.

**Can other people see my projects or keys?**
No. Projects and connections belong to your account. Keys are encrypted and cannot be
read back, not even by you.

**The Run button is greyed out.**
The administrator has limited who can run projects on the site. Export your project and
run it on your own computer.

**My step says "Plugin not installed".**
The step comes from a plugin you removed or turned off. Open the Marketplace and install
it again.

**A step cannot find data from an earlier step.**
Open the step and pick the value again with **Insert data**. This usually happens after
renaming or deleting the earlier step.

**Can I use a model running on my own computer?**
Not from the website, but yes in the downloaded project. See the note under
[Connections](#connections-ai-models-and-other-services).

**Which AI models work?**
Claude, OpenAI, and any service or server that speaks the OpenAI-compatible format, such
as OpenRouter, Ollama and LM Studio.
