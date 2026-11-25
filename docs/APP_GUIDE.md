# Learn AIUI (the Docs page)

<!-- Generated from apps/web/src/pages/Docs.tsx by apps/web/scripts/prerender.mjs on build. Do not edit. -->

## Learn AIUI

AIUI lets you build AI workflows, chat agents and teams of agents by putting blocks together. This guide explains the few ideas you need, with pictures and ready-to-try examples.
[Show the getting-started tips](/?tips=1)[Jump to the quick start](/docs#quick-start)

## What is AIUI?

In the app: [Docs](/docs#intro)

A no-code workshop for AI. You pick what to build, add steps like blocks, press Run, and AIUI shows you exactly what happened.

### Workflow

A task that runs step by step: fetch data, decide, send an email, call an API.
**Use it when:** The same job should run the same way every time.
Example: Every morning, fetch yesterday’s orders, build a CSV and email it to the team.

### AI Agent

An assistant that talks with people and uses the tools you give it.
**Use it when:** Someone should be able to ask questions in their own words.
Example: A help-desk assistant that looks up an order through your API and answers.

### Agent Solution

Several agents working together, each with its own job, led by a supervisor.
**Use it when:** A big task is easier when split between specialists.
Example: A lead agent asks a researcher for facts, then a writer turns them into a report.

## Your first AI Agent in 5 minutes

In the app: [Docs](/docs#quick-start)

Follow these four steps to build a chat agent that can use a tool, then talk to it.

-

### Add your AI model

Open [Connections](/connections), click **New connection** and choose ** AI model**. Pick a preset (Claude, OpenAI, OpenRouter, Ollama or LM Studio), check the model name, paste your API key if it needs one, and save.

-

### Create an AI Agent project

On [Home](/), click **New project → AI Agent → Agent with a tool**, keep the name and click ** Create and open**.

-

### Pick the model for the agent

Click the **assistant** step. In the panel on the right, set ** AI model** to your connection. The ** Role and instructions** field is the agent’s job description in plain words: change it whenever you like.

-

### Press Test chat and ask something

Click **Test chat** in the top bar, type What is to-do number 3, and is it done? and press Enter. The agent calls its tool, reads the answer and replies. Open ** Run log** to see every step it took.

**Done? Make it yours** Replace the lookup_todo tool with a **Call API** step that points at your own system, or link more tools. Each step you link to the Tools port becomes something the agent can do.

## Key ideas

In the app: [Docs](/docs#ideas)

Six words cover almost everything in AIUI.

### Project

One thing you are building: a workflow, an agent or a team of agents. It holds all its steps.

### Step

One block that does one job: call an API, ask AI, send an email, wait, decide. Steps run in order along the arrows.

### Start step

Every project begins with one: run it yourself, on a schedule, from a webhook, or when a chat message arrives.

### Connection

Saved access to a service, such as your AI model and its API key. Set it up once and use it in every project.

### Tool

A step linked to an agent’s Tools port. The agent decides by itself when to use it. Another agent can be a tool too.

### Run log

After each run, see every step in order with its input, its output and how long it took.

## Passing data between steps

In the app: [Docs](/docs#data)

A step can use what an earlier step produced. You write the step’s name and the value in double curly braces, like `{{fetch_posts.body}}`.

### Example

**fetch_posts** Call API **summarise** Ask AI **show_summary** Log message

| In this step | Field | Value |
| summarise | What to ask | `Summarise these posts: {{fetch_posts.body}}` |
| show_summary | Message | `{{summarise.text}}` |

### Values you will use most

- `{{input}}` the test input you typed when pressing Run.

- `{{input.message}}` the chat message, in projects that start with a chat.

- `{{step_name.field}}` a value from an earlier step, e.g. `{{summarise.text}}`.

**No need to type them** Fields that accept data have an **Insert data** button. It lists the values from earlier steps: click one and it is added for you.

## Three ways to build: Guided, Canvas and Code

In the app: [Docs](/docs#views)

Switch with the buttons at the top of the editor. All three show the same project, so use whichever feels easiest.

### Guided

A simple list, top to bottom. AIUI asks what should happen next and you choose. Best for your first projects.

### Canvas

Blocks and arrows you can drag around. Best for branches, loops, and agents with tools.

### Code

Read-only preview of the Python or C# program AIUI writes for your project. Nothing to type here.

## Run and test

In the app: [Docs](/docs#running)

Try your project right in the editor and see what each step did.

- **Run** (workflows): starts the project. You can give it test input as JSON, or leave `{}`.

- **Test chat** (agents and teams): opens a chat panel. Every message you send runs the project once.

- **Run log**: each step in order, with its result and how long it took. Click a result to open it in full, or a step name to jump to that step.

- **Problems**: things to fix before running, such as a required field left empty or a missing AI model.

- **Stop**: ends a run that takes too long.

**Run greyed out?** On a shared server the administrator decides who may run projects. Hover the **ⓘ** next to Run to see why. You can always [export the project](/docs#export) and run it on your own computer.

## Examples you can open in one click

In the app: [Docs](/docs#examples)

Each example is a template. Open it, look around, run it, then change it. Your copy is yours to edit.

### Fetch and process a list

Workflow

Calls a public API, goes through the results one by one and writes each to the run log.
**Run manually** ** fetch_posts**Call API ** each_post**For each ** log_title**Log message

You needNothing. It runs as-is.Try thisPress **Run → Run now**, then open the Run log. Change the log_title message to `{{item.title}} by user {{item.userId}}` and run again.

### Summarise data with AI

Workflow

Fetches data from an API and asks a model for a short summary.
**Run manually** ** fetch_posts**Call API ** summarise**Ask AI ** show_summary**Log message

You needAn AI model connection.Try thisPick your model in the summarise step and run it. Then change its prompt to ask for one sentence instead of three bullet points.

### Agent with a tool

AI Agent

A chat agent that looks up a to-do item through an API when you ask about one.
**Chat message** ** assistant**AI Agent
uses as tools **lookup_todo** Call API

You needAn AI model connection.Try thisAsk Is to-do 7 done?, then ask Tell me a joke. Watch the Run log: the agent uses its tool only when it needs to.

### Team of agents

Agent Solution

A lead agent hands work to a researcher and a writer, then replies with the result.
**Chat message** ** lead**AI Agent
uses as tools **researcher** AI Agent **writer** AI Agent

You needAn AI model connection, picked in each of the three agents.Try thisAsk for “a 3-sentence briefing on why bees matter”. The Run log shows the lead calling the researcher, then the writer.

## Connections

In the app: [Docs](/docs#connections)

A connection stores how to reach a service. Make it once in Connections and choose it in any step.

### AI model

| Preset | Good for |
| Claude | Strong reasoning and tool use. Needs an Anthropic API key. |
| OpenAI | GPT models. Needs an OpenAI API key. |
| OpenRouter | Many models from one key. |
| Ollama / LM Studio | Free models on your own computer, no key. |

### MCP server

Connects to a server that offers ready-made tools (the Model Context Protocol). Use it with the **Call MCP tool** step, or give its tools to an agent.
**Your keys stay safe** Secrets are stored encrypted on the server. They are never written into exported code: the export lists them in `.env.example` for you to fill in.

## Chat apps: Telegram, WhatsApp, Discord and Teams

In the app: [Docs](/docs#messaging)

The free Messaging Bridge plugin lets people talk to your project from the chat app they already use, and lets your project send its results to any of them.
**When a message arrives** from Telegram **AI Agent** writes the answer **Send a message** to Telegram, Discord…

- **Install it.** Open ** Marketplace**, find ** Messaging Bridge** and click Install. It is free.

- **Add a connection** for each app: Connections → New connection → ** Messaging app**, then pick the app. The form only asks for what that app needs (see the table).

- **Start from a template:** AI bot for Telegram, WhatsApp, Discord or Teams (AI Agent) answers every message, and Forward messages to another app (Workflow) passes messages on, for example from Telegram to Discord.

- **Press Run** to test with the Test message . Then ** Export** the project and start it with `python main.py` or `dotnet run`: it keeps running and answers every new message.

| App | What you need | How messages reach your project |
| Telegram | A bot token from @BotFather (send it `/newbot`). | Your project asks Telegram for new messages. No public address needed. |
| Discord | A bot token and a channel ID. Turn on Message Content Intent for the bot and invite it to the channel. | Your project checks the channel every few seconds. No public address needed. |
| WhatsApp | A Meta app with the WhatsApp Cloud API: access token, phone number ID, a verify token you choose, and the app secret. | Meta calls your project's web address, so it must be reachable over HTTPS (port 8080, path /messages by default). |
| Microsoft Teams | A Workflows webhook URL for sending, and an outgoing webhook's security token for receiving. | Teams calls your web address when someone @mentions the webhook in a channel. HTTPS is needed here too. |

### Who gets the message?

Leave **To** empty in Send a message to answer in the chat the message came from. To send somewhere else, type a Telegram chat ID, a WhatsApp number (country code, digits only) or a Discord channel ID, or set a Default recipient on the connection. Teams always posts to the channel of its webhook. Long answers are split into several messages automatically.
The start step gives you `{{input.text}}`, `{{input.senderName}}`, `{{input.chatId}}` and `{{input.platform}}`. Find them under **Insert data**.
**Good to know** WhatsApp only lets a business send free-form text within 24 hours of the person's last message. Teams needs a first answer within 5 seconds, so it gets a short "working on it" reply at once and the real answer follows. Each message is answered on its own; the bot does not remember earlier messages.

## Step library

In the app: [Docs](/docs#steps)

Every step you can add right now, grouped like in the editor. Plugins from the Marketplace add more.

### AI

**Ask AI** AI Send one question or instruction to a model and get its answer.

**AI Agent** AI A model that works towards a goal and decides by itself which tools to use. Link steps from its Tools port to give it abilities — including other agents.

### Start

**Run manually** Trigger Start the flow yourself, optionally with some test data.

**On a schedule** Trigger Run the flow again and again at a fixed interval.

**When a webhook is called** Trigger Another application starts the flow by calling a URL.

**When a chat message arrives** Trigger Start the flow each time someone sends a message. Use it with an AI Agent.

### Logic

**Condition** Logic Go one way if something is true, another way if it is not.

**For each** Logic Repeat the next steps once for every item in a list.

**Set variables** Logic Remember values under a name so later steps can use them.

**Wait** Logic Pause before continuing.

**Log message** Action Write a message to the run log. Handy for checking data while you build.

### Integrations

**Call API** Action Read from or send data to another application through its web API.

## Export as code

In the app: [Docs](/docs#export)

When your project works, take it anywhere. AIUI writes a complete, readable program for it.

- In the editor, click **Export** and choose ** Python project** or ** C# project**. A .zip file downloads.

- Unzip it. If the project uses keys, copy `.env.example` to `.env` and fill them in.

- Run it:
# Python
pip install -r requirements.txt
python main.py

# C#
dotnet run

The README inside the zip explains every file.

## Marketplace and plugins

In the app: [Docs](/docs#plugins)

Plugins add new steps, connection types and templates.

### Browse

Open [Marketplace](/marketplace), read what a plugin does and its reviews, and install it. New steps appear in the editor straight away.

### Manage

[My plugins](/marketplace/installed) lists what you installed. Uninstall a plugin there if you no longer need it.

### Build your own

Developers can write steps in the [Developer portal](/developer) and publish them for everyone.

## Help and common problems

In the app: [Docs](/docs#faq)

Problems says “"AI model" is required”.
Click the agent step and choose your connection in **AI model**. In a team, every agent needs one. No connection yet? See [Connections](/docs#connections).

The agent never uses its tool.
Check the tool is linked to the agent’s **Tools** port (not to its normal output), give the tool a clear name, and say in the agent’s instructions when to use it, e.g. Use lookup_todo when the user asks about a to-do.

My local model (Ollama) cannot be reached.
Make sure Ollama is running. If AIUI runs in Docker, `localhost` means the container itself: use `http://host.docker.internal:11434/v1` as the address instead.

Run or Test chat is greyed out.
Running may be limited to administrators on this server. The **ⓘ** next to the button says why. Ask an administrator, or [export](/docs#export) the project and run it yourself.

A step failed. How do I find out why?
Open **Run log**. The failed step is shown in red with its error message; click it to jump to that step. Fix the field, then run again.

Did I lose my work?
No. AIUI saves as you go; the top bar shows “Saved”. Use Undo (Ctrl+Z) to step back, and Duplicate on Home to keep a copy before big changes.

**Quick keys** Ctrl + K search and commands (add a step, switch view, go anywhere) · Ctrl + Z undo · Ctrl + Shift + Z redo
