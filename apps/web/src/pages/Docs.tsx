import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, BookOpen, Lightbulb, Sparkles, X } from 'lucide-react';
import type { NodeKind, NodeTypeInfo, ProjectType } from '@aiui/shared';
import { Button } from '../components/ui';
import { PROJECT_TYPES } from '../lib/format';
import { Icon, KIND_LABEL } from '../lib/icons';
import { PUBLIC_PAGES, usePageMeta } from '../lib/site';
import { useApp } from '../stores/app';

const SECTIONS = [
  { id: 'intro', label: 'What is AIUI?' },
  { id: 'quick-start', label: 'Your first AI Agent' },
  { id: 'ideas', label: 'Key ideas' },
  { id: 'data', label: 'Passing data between steps' },
  { id: 'views', label: 'Guided, Canvas and Code' },
  { id: 'running', label: 'Run and test' },
  { id: 'examples', label: 'Examples' },
  { id: 'connections', label: 'Connections' },
  { id: 'messaging', label: 'Telegram, WhatsApp, Discord, Teams' },
  { id: 'steps', label: 'Step library' },
  { id: 'export', label: 'Export as code' },
  { id: 'plugins', label: 'Marketplace and plugins' },
  { id: 'faq', label: 'Help and common problems' },
] as const;

export function DocsPage() {
  usePageMeta(PUBLIC_PAGES.docs);
  const location = useLocation();

  const [zoom, setZoom] = useState<{ src: string; alt: string } | null>(null);
  const [active, setActive] = useState<string>(SECTIONS[0].id);

  // Jump to "#section" links, also when they come from another page.
  useEffect(() => {
    const id = location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView({ block: 'start' });
  }, [location.hash]);

  // Highlight the section being read in the contents list.
  useEffect(() => {
    const seen = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting);
        const first = SECTIONS.find((s) => seen.get(s.id));
        if (first) setActive(first.id);
      },
      { rootMargin: '-10% 0px -70% 0px' },
    );
    for (const s of SECTIONS) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  const show = (src: string, alt: string) => setZoom({ src, alt });

  return (
    <div className="page docs">
      <aside className="docs-toc" aria-label="Contents">
        <div className="docs-toc-head">
          <BookOpen size={16} /> Documentation
        </div>
        <nav>
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`} className={active === s.id ? 'active' : ''}>
              {s.label}
            </a>
          ))}
        </nav>
      </aside>

      <article className="docs-body">
        <header className="docs-hero">
          <h1>Learn AIUI</h1>
          <p>
            AIUI lets you build AI workflows, chat agents and teams of agents by putting blocks together. This guide explains the few ideas
            you need, with pictures and ready-to-try examples.
          </p>
          <div className="docs-hero-actions">
            <Link to="/?tips=1" className="btn btn-primary btn-md">
              <Sparkles size={15} /> Show the getting-started tips
            </Link>
            <a href="#quick-start" className="btn btn-default btn-md">
              Jump to the quick start <ArrowRight size={15} />
            </a>
          </div>
        </header>

        <Intro show={show} />
        <QuickStart show={show} />
        <KeyIdeas />
        <DataSection show={show} />
        <Views show={show} />
        <Running show={show} />
        <Examples />
        <Connections show={show} />
        <Messaging />
        <StepLibrary />
        <ExportSection show={show} />
        <Plugins />
        <Faq />
      </article>

      {zoom && (
        <div className="docs-zoom" onClick={() => setZoom(null)} role="dialog" aria-label={zoom.alt}>
          <button type="button" className="icon-btn" aria-label="Close">
            <X size={18} />
          </button>
          <img src={zoom.src} alt={zoom.alt} />
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── Building blocks ─────────────────────────────

type Show = (src: string, alt: string) => void;

function Section({ id, title, lead, children }: { id: string; title: string; lead?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="docs-section">
      <h2>{title}</h2>
      {lead && <p className="docs-lead">{lead}</p>}
      {children}
    </section>
  );
}

function Figure({ src, alt, caption, show }: { src: string; alt: string; caption?: ReactNode; show: Show }) {
  return (
    <figure className="docs-figure">
      <button type="button" onClick={() => show(src, alt)} title="Click to enlarge">
        <img src={src} alt={alt} loading="lazy" />
      </button>
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}

function Callout({ kind = 'tip', title, children }: { kind?: 'tip' | 'warn'; title?: string; children: ReactNode }) {
  return (
    <div className={`docs-callout ${kind}`}>
      {kind === 'tip' ? <Lightbulb size={17} /> : <AlertTriangle size={17} />}
      <div>
        {title && <strong>{title}</strong>}
        {children}
      </div>
    </div>
  );
}

interface FlowStep {
  label: string;
  icon: string;
  kind: NodeKind;
  note?: string;
}

/** A small left-to-right picture of a project's steps. */
function Flow({ steps, tools }: { steps: FlowStep[]; tools?: FlowStep[] }) {
  return (
    <div className="docs-flow">
      <div className="docs-flow-row">
        {steps.map((s, i) => (
          <span key={s.label} className="docs-flow-item">
            {i > 0 && <ArrowRight size={16} className="docs-flow-arrow" />}
            <FlowChip step={s} />
          </span>
        ))}
      </div>
      {tools && tools.length > 0 && (
        <div className="docs-flow-tools">
          <span className="docs-flow-tools-label">uses as tools</span>
          {tools.map((t) => (
            <FlowChip key={t.label} step={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function FlowChip({ step }: { step: FlowStep }) {
  return (
    <span className={`docs-chip kind-${step.kind}`}>
      <span className={`tile tile-sm kind-${step.kind}`}>
        <Icon name={step.icon} size={14} />
      </span>
      <span>
        <strong>{step.label}</strong>
        {step.note && <small>{step.note}</small>}
      </span>
    </span>
  );
}

function Steps({ children }: { children: ReactNode }) {
  return <ol className="docs-steps">{children}</ol>;
}

// ───────────────────────────── Sections ─────────────────────────────

const TYPE_EXAMPLES: Record<ProjectType, { when: string; example: string }> = {
  workflow: {
    when: 'The same job should run the same way every time.',
    example: 'Every morning, fetch yesterday’s orders, build a CSV and email it to the team.',
  },
  agent: {
    when: 'Someone should be able to ask questions in their own words.',
    example: 'A help-desk assistant that looks up an order through your API and answers.',
  },
  solution: {
    when: 'A big task is easier when split between specialists.',
    example: 'A lead agent asks a researcher for facts, then a writer turns them into a report.',
  },
};

function Intro({ show }: { show: Show }) {
  return (
    <Section
      id="intro"
      title="What is AIUI?"
      lead="A no-code workshop for AI. You pick what to build, add steps like blocks, press Run, and AIUI shows you exactly what happened."
    >
      <div className="docs-cards three">
        {(Object.keys(PROJECT_TYPES) as ProjectType[]).map((t) => (
          <div key={t} className="docs-card">
            <span className={`tile tile-${t}`}>
              <Icon name={PROJECT_TYPES[t].icon} size={18} />
            </span>
            <h3>{PROJECT_TYPES[t].label}</h3>
            <p>{PROJECT_TYPES[t].blurb}</p>
            <p className="small">
              <strong>Use it when:</strong> {TYPE_EXAMPLES[t].when}
            </p>
            <p className="small muted">
              <em>Example:</em> {TYPE_EXAMPLES[t].example}
            </p>
          </div>
        ))}
      </div>
      <Figure
        src="/guide/new-project.webp"
        alt="The New project wizard asking what you want to build"
        caption="Click New project on Home and pick one of the three types."
        show={show}
      />
    </Section>
  );
}

function QuickStart({ show }: { show: Show }) {
  return (
    <Section id="quick-start" title="Your first AI Agent in 5 minutes" lead="Follow these four steps to build a chat agent that can use a tool, then talk to it.">
      <Steps>
        <li>
          <h3>Add your AI model</h3>
          <p>
            Open <Link to="/connections">Connections</Link>, click <strong>New connection</strong> and choose <strong>AI model</strong>. Pick a
            preset (Claude, OpenAI, OpenRouter, Ollama or LM Studio), check the model name, paste your API key if it needs one, and save.
          </p>
          <Figure src="/guide/connection.webp" alt="The New connection dialog for an AI model" caption="One connection can be used by all your projects." show={show} />
        </li>
        <li>
          <h3>Create an AI Agent project</h3>
          <p>
            On <Link to="/">Home</Link>, click <strong>New project → AI Agent → Agent with a tool</strong>, keep the name and click{' '}
            <strong>Create and open</strong>.
          </p>
          <Figure src="/guide/new-agent.webp" alt="The New project wizard showing AI Agent templates" show={show} />
        </li>
        <li>
          <h3>Pick the model for the agent</h3>
          <p>
            Click the <strong>assistant</strong> step. In the panel on the right, set <strong>AI model</strong> to your connection. The{' '}
            <strong>Role and instructions</strong> field is the agent’s job description in plain words: change it whenever you like.
          </p>
          <Figure
            src="/guide/agent-model.webp"
            alt="The agent step selected, with the AI model field set"
            caption="The tool lookup_todo is linked to the agent’s Tools port, so the agent can decide to call it."
            show={show}
          />
        </li>
        <li>
          <h3>Press Test chat and ask something</h3>
          <p>
            Click <strong>Test chat</strong> in the top bar, type <q>What is to-do number 3, and is it done?</q> and press <kbd>Enter</kbd>.
            The agent calls its tool, reads the answer and replies. Open <strong>Run log</strong> to see every step it took.
          </p>
          <Figure src="/guide/agent-chat.webp" alt="The chat panel with the agent answer" show={show} />
        </li>
      </Steps>
      <Callout title="Done? Make it yours">
        <p>
          Replace the <em>lookup_todo</em> tool with a <strong>Call API</strong> step that points at your own system, or link more tools. Each
          step you link to the Tools port becomes something the agent can do.
        </p>
      </Callout>
    </Section>
  );
}

const IDEAS: { icon: string; title: string; text: ReactNode }[] = [
  { icon: 'folder-open', title: 'Project', text: 'One thing you are building: a workflow, an agent or a team of agents. It holds all its steps.' },
  { icon: 'square-stack', title: 'Step', text: 'One block that does one job: call an API, ask AI, send an email, wait, decide. Steps run in order along the arrows.' },
  { icon: 'play', title: 'Start step', text: 'Every project begins with one: run it yourself, on a schedule, from a webhook, or when a chat message arrives.' },
  { icon: 'plug', title: 'Connection', text: 'Saved access to a service, such as your AI model and its API key. Set it up once and use it in every project.' },
  { icon: 'wrench', title: 'Tool', text: 'A step linked to an agent’s Tools port. The agent decides by itself when to use it. Another agent can be a tool too.' },
  { icon: 'scroll-text', title: 'Run log', text: 'After each run, see every step in order with its input, its output and how long it took.' },
];

function KeyIdeas() {
  return (
    <Section id="ideas" title="Key ideas" lead="Six words cover almost everything in AIUI.">
      <div className="docs-cards three">
        {IDEAS.map((i) => (
          <div key={i.title} className="docs-card compact">
            <span className="tile">
              <Icon name={i.icon} size={17} />
            </span>
            <h3>{i.title}</h3>
            <p>{i.text}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

function DataSection({ show }: { show: Show }) {
  return (
    <Section
      id="data"
      title="Passing data between steps"
      lead={
        <>
          A step can use what an earlier step produced. You write the step’s name and the value in double curly braces, like{' '}
          <code>{'{{fetch_posts.body}}'}</code>.
        </>
      }
    >
      <div className="docs-two">
        <div>
          <h3>Example</h3>
          <Flow
            steps={[
              { label: 'fetch_posts', icon: 'globe', kind: 'action', note: 'Call API' },
              { label: 'summarise', icon: 'sparkles', kind: 'ai', note: 'Ask AI' },
              { label: 'show_summary', icon: 'scroll-text', kind: 'logic', note: 'Log message' },
            ]}
          />
          <table className="docs-table">
            <thead>
              <tr>
                <th>In this step</th>
                <th>Field</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>summarise</td>
                <td>What to ask</td>
                <td>
                  <code>{'Summarise these posts: {{fetch_posts.body}}'}</code>
                </td>
              </tr>
              <tr>
                <td>show_summary</td>
                <td>Message</td>
                <td>
                  <code>{'{{summarise.text}}'}</code>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <h3>Values you will use most</h3>
          <ul className="docs-list">
            <li>
              <code>{'{{input}}'}</code> the test input you typed when pressing Run.
            </li>
            <li>
              <code>{'{{input.message}}'}</code> the chat message, in projects that start with a chat.
            </li>
            <li>
              <code>{'{{step_name.field}}'}</code> a value from an earlier step, e.g. <code>{'{{summarise.text}}'}</code>.
            </li>
          </ul>
          <Callout title="No need to type them">
            <p>
              Fields that accept data have an <strong>Insert data</strong> button. It lists the values from earlier steps: click one and it is
              added for you.
            </p>
          </Callout>
        </div>
      </div>
      <Figure src="/guide/data-picker.webp" alt="The insert-data list on a step field" caption="The insert list shows what each earlier step gives you." show={show} />
    </Section>
  );
}

function Views({ show }: { show: Show }) {
  return (
    <Section id="views" title="Three ways to build: Guided, Canvas and Code" lead="Switch with the buttons at the top of the editor. All three show the same project, so use whichever feels easiest.">
      <div className="docs-views">
        <div>
          <h3>Guided</h3>
          <p>A simple list, top to bottom. AIUI asks what should happen next and you choose. Best for your first projects.</p>
          <Figure src="/guide/guided.webp" alt="Guided view: steps as a list" show={show} />
        </div>
        <div>
          <h3>Canvas</h3>
          <p>Blocks and arrows you can drag around. Best for branches, loops, and agents with tools.</p>
          <Figure src="/guide/canvas.webp" alt="Canvas view: steps as connected blocks" show={show} />
        </div>
        <div>
          <h3>Code</h3>
          <p>Read-only preview of the Python or C# program AIUI writes for your project. Nothing to type here.</p>
          <Figure src="/guide/code.webp" alt="Code view: the generated program" show={show} />
        </div>
      </div>
    </Section>
  );
}

function Running({ show }: { show: Show }) {
  return (
    <Section id="running" title="Run and test" lead="Try your project right in the editor and see what each step did.">
      <div className="docs-two">
        <div>
          <ul className="docs-list">
            <li>
              <strong>Run</strong> (workflows): starts the project. You can give it test input as JSON, or leave <code>{'{}'}</code>.
            </li>
            <li>
              <strong>Test chat</strong> (agents and teams): opens a chat panel. Every message you send runs the project once.
            </li>
            <li>
              <strong>Run log</strong>: each step in order, with its result and how long it took. Click a result to open it in full, or a step
              name to jump to that step.
            </li>
            <li>
              <strong>Problems</strong>: things to fix before running, such as a required field left empty or a missing AI model.
            </li>
            <li>
              <strong>Stop</strong>: ends a run that takes too long.
            </li>
          </ul>
          <Callout kind="warn" title="Run greyed out?">
            <p>
              On a shared server the administrator decides who may run projects. Hover the <strong>ⓘ</strong> next to Run to see why. You
              can always <a href="#export">export the project</a> and run it on your own computer.
            </p>
          </Callout>
        </div>
        <Figure src="/guide/run-log.webp" alt="The run log after a workflow run" caption="A finished run: green ticks for steps that worked." show={show} />
      </div>
    </Section>
  );
}

interface Example {
  template: string;
  type: ProjectType;
  name: string;
  what: string;
  needs: string;
  steps: FlowStep[];
  tools?: FlowStep[];
  tryIt: ReactNode;
}

const EXAMPLES: Example[] = [
  {
    template: 'aiui.ai.fetch-and-loop',
    type: 'workflow',
    name: 'Fetch and process a list',
    what: 'Calls a public API, goes through the results one by one and writes each to the run log.',
    needs: 'Nothing. It runs as-is.',
    steps: [
      { label: 'Run manually', icon: 'play', kind: 'trigger' },
      { label: 'fetch_posts', icon: 'globe', kind: 'action', note: 'Call API' },
      { label: 'each_post', icon: 'repeat', kind: 'logic', note: 'For each' },
      { label: 'log_title', icon: 'scroll-text', kind: 'logic', note: 'Log message' },
    ],
    tryIt: (
      <>
        Press <strong>Run → Run now</strong>, then open the Run log. Change the log_title message to <code>{'{{item.title}} by user {{item.userId}}'}</code> and run again.
      </>
    ),
  },
  {
    template: 'aiui.ai.summarise-api',
    type: 'workflow',
    name: 'Summarise data with AI',
    what: 'Fetches data from an API and asks a model for a short summary.',
    needs: 'An AI model connection.',
    steps: [
      { label: 'Run manually', icon: 'play', kind: 'trigger' },
      { label: 'fetch_posts', icon: 'globe', kind: 'action', note: 'Call API' },
      { label: 'summarise', icon: 'sparkles', kind: 'ai', note: 'Ask AI' },
      { label: 'show_summary', icon: 'scroll-text', kind: 'logic', note: 'Log message' },
    ],
    tryIt: <>Pick your model in the summarise step and run it. Then change its prompt to ask for one sentence instead of three bullet points.</>,
  },
  {
    template: 'aiui.ai.support-agent',
    type: 'agent',
    name: 'Agent with a tool',
    what: 'A chat agent that looks up a to-do item through an API when you ask about one.',
    needs: 'An AI model connection.',
    steps: [
      { label: 'Chat message', icon: 'message-square', kind: 'trigger' },
      { label: 'assistant', icon: 'bot', kind: 'ai', note: 'AI Agent' },
    ],
    tools: [{ label: 'lookup_todo', icon: 'globe', kind: 'action', note: 'Call API' }],
    tryIt: (
      <>
        Ask <q>Is to-do 7 done?</q>, then ask <q>Tell me a joke</q>. Watch the Run log: the agent uses its tool only when it needs to.
      </>
    ),
  },
  {
    template: 'aiui.ai.research-team',
    type: 'solution',
    name: 'Team of agents',
    what: 'A lead agent hands work to a researcher and a writer, then replies with the result.',
    needs: 'An AI model connection, picked in each of the three agents.',
    steps: [
      { label: 'Chat message', icon: 'message-square', kind: 'trigger' },
      { label: 'lead', icon: 'bot', kind: 'ai', note: 'AI Agent' },
    ],
    tools: [
      { label: 'researcher', icon: 'bot', kind: 'ai', note: 'AI Agent' },
      { label: 'writer', icon: 'bot', kind: 'ai', note: 'AI Agent' },
    ],
    tryIt: <>Ask for “a 3-sentence briefing on why bees matter”. The Run log shows the lead calling the researcher, then the writer.</>,
  },
];

function Examples() {
  const navigate = useNavigate();
  const templates = useApp((s) => s.catalog.templates);
  const open = (template: string) => navigate(`/?template=${encodeURIComponent(template)}`);
  return (
    <Section id="examples" title="Examples you can open in one click" lead="Each example is a template. Open it, look around, run it, then change it. Your copy is yours to edit.">
      <div className="docs-examples">
        {EXAMPLES.map((ex) => {
          const available = templates.some((t) => t.id === ex.template);
          return (
            <div key={ex.template} className="docs-example">
              <div className="docs-example-head">
                <span className={`tile tile-${ex.type}`}>
                  <Icon name={PROJECT_TYPES[ex.type].icon} size={18} />
                </span>
                <div>
                  <h3>{ex.name}</h3>
                  <span className="muted small">{PROJECT_TYPES[ex.type].label}</span>
                </div>
                <span className="grow" />
                {available && (
                  <Button onClick={() => open(ex.template)}>
                    Use this template <ArrowRight size={14} />
                  </Button>
                )}
              </div>
              <p>{ex.what}</p>
              <Flow steps={ex.steps} tools={ex.tools} />
              <dl className="docs-example-meta">
                <dt>You need</dt>
                <dd>{ex.needs}</dd>
                <dt>Try this</dt>
                <dd>{ex.tryIt}</dd>
              </dl>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function Connections({ show }: { show: Show }) {
  return (
    <Section id="connections" title="Connections" lead="A connection stores how to reach a service. Make it once in Connections and choose it in any step.">
      <div className="docs-two">
        <div>
          <h3>AI model</h3>
          <table className="docs-table">
            <thead>
              <tr>
                <th>Preset</th>
                <th>Good for</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Claude</td>
                <td>Strong reasoning and tool use. Needs an Anthropic API key.</td>
              </tr>
              <tr>
                <td>OpenAI</td>
                <td>GPT models. Needs an OpenAI API key.</td>
              </tr>
              <tr>
                <td>OpenRouter</td>
                <td>Many models from one key.</td>
              </tr>
              <tr>
                <td>Ollama / LM Studio</td>
                <td>Free models on your own computer, no key.</td>
              </tr>
            </tbody>
          </table>
          <h3>MCP server</h3>
          <p>
            Connects to a server that offers ready-made tools (the Model Context Protocol). Use it with the <strong>Call MCP tool</strong> step,
            or give its tools to an agent.
          </p>
          <Callout title="Your keys stay safe">
            <p>Secrets are stored encrypted on the server. They are never written into exported code: the export lists them in <code>.env.example</code> for you to fill in.</p>
          </Callout>
        </div>
        <Figure src="/guide/connection.webp" alt="The New connection dialog" show={show} />
      </div>
    </Section>
  );
}

function Messaging() {
  return (
    <Section
      id="messaging"
      title="Chat apps: Telegram, WhatsApp, Discord and Teams"
      lead="The free Messaging Bridge plugin lets people talk to your project from the chat app they already use, and lets your project send its results to any of them."
    >
      <Flow
        steps={[
          { label: 'When a message arrives', icon: 'messages-square', kind: 'trigger', note: 'from Telegram' },
          { label: 'AI Agent', icon: 'bot', kind: 'ai', note: 'writes the answer' },
          { label: 'Send a message', icon: 'send', kind: 'action', note: 'to Telegram, Discord…' },
        ]}
      />
      <Steps>
        <li>
          <strong>Install it.</strong> Open <strong>Marketplace</strong>, find <strong>Messaging Bridge</strong> and click Install. It is free.
        </li>
        <li>
          <strong>Add a connection</strong> for each app: Connections → New connection → <strong>Messaging app</strong>, then pick the app.
          The form only asks for what that app needs (see the table).
        </li>
        <li>
          <strong>Start from a template:</strong> <em>AI bot for Telegram, WhatsApp, Discord or Teams</em> (AI Agent) answers every message,
          and <em>Forward messages to another app</em> (Workflow) passes messages on, for example from Telegram to Discord.
        </li>
        <li>
          <strong>Press Run</strong> to test with the <em>Test message</em>. Then <strong>Export</strong> the project and start it with{' '}
          <code>python main.py</code> or <code>dotnet run</code>: it keeps running and answers every new message.
        </li>
      </Steps>

      <table className="docs-table">
        <thead>
          <tr>
            <th>App</th>
            <th>What you need</th>
            <th>How messages reach your project</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Telegram</td>
            <td>A bot token from @BotFather (send it <code>/newbot</code>).</td>
            <td>Your project asks Telegram for new messages. No public address needed.</td>
          </tr>
          <tr>
            <td>Discord</td>
            <td>A bot token and a channel ID. Turn on <em>Message Content Intent</em> for the bot and invite it to the channel.</td>
            <td>Your project checks the channel every few seconds. No public address needed.</td>
          </tr>
          <tr>
            <td>WhatsApp</td>
            <td>A Meta app with the WhatsApp Cloud API: access token, phone number ID, a verify token you choose, and the app secret.</td>
            <td>Meta calls your project's web address, so it must be reachable over HTTPS (port 8080, path /messages by default).</td>
          </tr>
          <tr>
            <td>Microsoft Teams</td>
            <td>A Workflows webhook URL for sending, and an outgoing webhook's security token for receiving.</td>
            <td>Teams calls your web address when someone @mentions the webhook in a channel. HTTPS is needed here too.</td>
          </tr>
        </tbody>
      </table>

      <h3>Who gets the message?</h3>
      <p>
        Leave <strong>To</strong> empty in <em>Send a message</em> to answer in the chat the message came from. To send somewhere else, type a
        Telegram chat ID, a WhatsApp number (country code, digits only) or a Discord channel ID, or set a <em>Default recipient</em> on the
        connection. Teams always posts to the channel of its webhook. Long answers are split into several messages automatically.
      </p>
      <p>
        The start step gives you <code>{'{{input.text}}'}</code>, <code>{'{{input.senderName}}'}</code>,{' '}
        <code>{'{{input.chatId}}'}</code> and <code>{'{{input.platform}}'}</code>. Find them under <strong>Insert data</strong>.
      </p>
      <Callout kind="warn" title="Good to know">
        <p>
          WhatsApp only lets a business send free-form text within 24 hours of the person's last message. Teams needs a first answer within 5
          seconds, so it gets a short "working on it" reply at once and the real answer follows. Each message is answered on its own; the bot
          does not remember earlier messages.
        </p>
      </Callout>
    </Section>
  );
}

function StepLibrary() {
  const nodeTypes = useApp((s) => s.catalog.nodeTypes);
  const signedIn = useApp((s) => !!s.user);
  const groups = useMemo(() => {
    const map = new Map<string, NodeTypeInfo[]>();
    for (const n of nodeTypes) {
      const list = map.get(n.category) ?? [];
      list.push(n);
      map.set(n.category, list);
    }
    return [...map.entries()];
  }, [nodeTypes]);
  return (
    <Section id="steps" title="Step library" lead="Every step you can add right now, grouped like in the editor. Plugins from the Marketplace add more.">
      {groups.length === 0 && signedIn && <p className="muted">No steps are installed.</p>}
      {groups.map(([category, list]) => (
        <div key={category} className="docs-step-group">
          <h3>{category}</h3>
          <div className="docs-step-grid">
            {list.map((n) => (
              <div key={n.type} className="docs-step">
                <span className={`tile tile-sm kind-${n.kind}`}>
                  <Icon name={n.icon} size={14} />
                </span>
                <div>
                  <strong>{n.label}</strong>
                  <span className="docs-kind">{KIND_LABEL[n.kind]}</span>
                  <p>{n.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </Section>
  );
}

function ExportSection({ show }: { show: Show }) {
  return (
    <Section id="export" title="Export as code" lead="When your project works, take it anywhere. AIUI writes a complete, readable program for it.">
      <div className="docs-two">
        <div>
          <Steps>
            <li>
              <p>
                In the editor, click <strong>Export</strong> and choose <strong>Python project</strong> or <strong>C# project</strong>. A .zip
                file downloads.
              </p>
            </li>
            <li>
              <p>
                Unzip it. If the project uses keys, copy <code>.env.example</code> to <code>.env</code> and fill them in.
              </p>
            </li>
            <li>
              <p>Run it:</p>
              <pre className="docs-code">{`# Python
pip install -r requirements.txt
python main.py

# C#
dotnet run`}</pre>
            </li>
          </Steps>
          <p className="muted small">The README inside the zip explains every file.</p>
        </div>
        <Figure src="/guide/export.webp" alt="The Export menu with Python and C# options" show={show} />
      </div>
    </Section>
  );
}

function Plugins() {
  return (
    <Section id="plugins" title="Marketplace and plugins" lead="Plugins add new steps, connection types and templates.">
      <div className="docs-cards three">
        <div className="docs-card compact">
          <span className="tile">
            <Icon name="store" size={17} />
          </span>
          <h3>Browse</h3>
          <p>
            Open <Link to="/marketplace">Marketplace</Link>, read what a plugin does and its reviews, and install it. New steps appear in the
            editor straight away.
          </p>
        </div>
        <div className="docs-card compact">
          <span className="tile">
            <Icon name="puzzle" size={17} />
          </span>
          <h3>Manage</h3>
          <p>
            <Link to="/marketplace/installed">My plugins</Link> lists what you installed. Uninstall a plugin there if you no longer need it.
          </p>
        </div>
        <div className="docs-card compact">
          <span className="tile">
            <Icon name="code-xml" size={17} />
          </span>
          <h3>Build your own</h3>
          <p>
            Developers can write steps in the <Link to="/developer">Developer portal</Link> and publish them for everyone.
          </p>
        </div>
      </div>
    </Section>
  );
}

const FAQ: { q: string; a: ReactNode }[] = [
  {
    q: 'Problems says “"AI model" is required”.',
    a: (
      <>
        Click the agent step and choose your connection in <strong>AI model</strong>. In a team, every agent needs one. No connection yet? See{' '}
        <a href="#connections">Connections</a>.
      </>
    ),
  },
  {
    q: 'The agent never uses its tool.',
    a: (
      <>
        Check the tool is linked to the agent’s <strong>Tools</strong> port (not to its normal output), give the tool a clear name, and say in
        the agent’s instructions when to use it, e.g. <q>Use lookup_todo when the user asks about a to-do.</q>
      </>
    ),
  },
  {
    q: 'My local model (Ollama) cannot be reached.',
    a: (
      <>
        Make sure Ollama is running. If AIUI runs in Docker, <code>localhost</code> means the container itself: use{' '}
        <code>http://host.docker.internal:11434/v1</code> as the address instead.
      </>
    ),
  },
  {
    q: 'Run or Test chat is greyed out.',
    a: (
      <>
        Running may be limited to administrators on this server. The <strong>ⓘ</strong> next to the button says why. Ask an administrator,
        or <a href="#export">export</a> the project and run it yourself.
      </>
    ),
  },
  {
    q: 'A step failed. How do I find out why?',
    a: (
      <>
        Open <strong>Run log</strong>. The failed step is shown in red with its error message; click it to jump to that step. Fix the field,
        then run again.
      </>
    ),
  },
  {
    q: 'Did I lose my work?',
    a: <>No. AIUI saves as you go; the top bar shows “Saved”. Use Undo (Ctrl+Z) to step back, and Duplicate on Home to keep a copy before big changes.</>,
  },
];

function Faq() {
  return (
    <Section id="faq" title="Help and common problems">
      <div className="docs-faq">
        {FAQ.map((f) => (
          <details key={f.q}>
            <summary>{f.q}</summary>
            <p>{f.a}</p>
          </details>
        ))}
      </div>
      <Callout title="Quick keys">
        <p>
          <kbd>Ctrl</kbd> + <kbd>K</kbd> search and commands (add a step, switch view, go anywhere) · <kbd>Ctrl</kbd> + <kbd>Z</kbd> undo ·{' '}
          <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd> redo
        </p>
      </Callout>
    </Section>
  );
}
