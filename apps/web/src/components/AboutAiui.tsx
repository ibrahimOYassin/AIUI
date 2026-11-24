import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BookOpen,
  Bot,
  Boxes,
  Braces,
  CalendarClock,
  Download,
  KeyRound,
  LayoutTemplate,
  MessagesSquare,
  Play,
  Plug,
  Plus,
  Sparkles,
  Store,
  Users,
  Workflow,
} from 'lucide-react';

/** Plain-text questions and answers: shown on the page and given to search engines as FAQ data. */
export const LANDING_FAQ: { q: string; a: string }[] = [
  {
    q: 'What is AIUI?',
    a: 'AIUI is a no-code IDE that runs in your browser. You build AI workflows, AI agents and teams of agents by putting steps together and filling in forms, test them in the browser, and download the result as a complete Python or C# project.',
  },
  {
    q: 'Do I need to know how to code?',
    a: 'No. Everything is built with forms, a step-by-step guided view and a visual canvas. You only write code if you want to publish your own plugins in the Marketplace.',
  },
  {
    q: 'Which AI models can I use?',
    a: 'Claude, OpenAI, and any service or server that speaks the OpenAI-compatible format, such as OpenRouter, Ollama and LM Studio.',
  },
  {
    q: 'Can I run what I build outside AIUI?',
    a: 'Yes. Export any project as a ready-to-run Python or C# project with a README. It runs on your own computer or server, on a schedule, as a webhook or as a chat bot.',
  },
  {
    q: 'Can my AI agent answer on Telegram, WhatsApp, Discord or Microsoft Teams?',
    a: 'Yes. Install the free Messaging Bridge plugin from the Marketplace, connect your bot, and start from the "AI bot" template. Messages from one app can also be forwarded to another.',
  },
  {
    q: 'Are my API keys safe?',
    a: 'Keys are saved in Connections, encrypted, and cannot be read back. Exported projects never contain them: they read keys from environment variables in a .env file.',
  },
  {
    q: 'How much does AIUI cost?',
    a: 'Creating an account is free, and the built-in steps and many Marketplace plugins are free. Some Marketplace plugins from developers are paid.',
  },
];

const BUILD = [
  {
    icon: Workflow,
    tone: 'workflow',
    title: 'Workflows',
    text: 'Tasks that run step by step: fetch data from an API, decide what to do, summarise it with AI and send the result.',
  },
  {
    icon: Bot,
    tone: 'agent',
    title: 'AI agents',
    text: 'An AI that works towards a goal, chats with people and decides which tools to use: APIs, MCP servers or other steps.',
  },
  {
    icon: Users,
    tone: 'solution',
    title: 'Teams of agents',
    text: 'Several agents working together, such as a lead agent handing work to a researcher and a writer.',
  },
];

const STEPS = [
  { icon: LayoutTemplate, title: 'Pick a template', text: 'Start from a ready example or a blank page. Templates run without any setup.' },
  { icon: Plug, title: 'Connect an AI model', text: 'Add your Claude or OpenAI key once, or point to a local model.' },
  { icon: Play, title: 'Run and test', text: 'Run it in the browser, chat with your agent and see every step in the Run log.' },
  { icon: Download, title: 'Export as code', text: 'Download a clean Python or C# project that runs anywhere.' },
];

const FEATURES = [
  { icon: Sparkles, title: 'Guided, Canvas and Code views', text: 'Answer questions step by step, arrange blocks on a canvas, or read the generated code. All three show the same project.' },
  { icon: Boxes, title: 'Any AI model', text: 'Claude, OpenAI, OpenRouter, Ollama and LM Studio. Switch models without rebuilding your flow.' },
  { icon: Braces, title: 'Real Python and C# code', text: 'Exports are plain, readable projects with a README, not a black box. Keep them in your own repository.' },
  { icon: MessagesSquare, title: 'Telegram, WhatsApp, Discord and Teams', text: 'Turn an agent into a chat bot, or forward messages from one chat app to another.' },
  { icon: CalendarClock, title: 'Schedules, webhooks and chat', text: 'Start a flow by hand, on a schedule, when a webhook is called or when a chat message arrives.' },
  { icon: Store, title: 'Marketplace and plugins', text: 'Add steps for email, files, reports and MCP tools, or publish your own plugins for others.' },
  { icon: KeyRound, title: 'Your keys stay yours', text: 'Keys are encrypted and never written into exported code. Projects are private to your account.' },
  { icon: BookOpen, title: 'Learn as you go', text: 'Welcome tips, a full guide with pictures and examples you can open in one click.' },
];

const SHOTS = [
  { src: '/guide/agent-chat.webp', alt: 'Chatting with an AI agent in the AIUI test chat', caption: 'Test your agent in a chat before you ship it.' },
  { src: '/guide/guided.webp', alt: 'The Guided view in AIUI, with each step as a short form', caption: 'Guided view: each step is a short form.' },
  { src: '/guide/code.webp', alt: 'The generated Python code for an AIUI project', caption: 'Code view: the exact Python or C# you download.' },
];

/** The top of Home for guests: what AIUI is, and how to start. */
export function GuestHero({ onNewProject, onTips }: { onNewProject: () => void; onTips: () => void }) {
  return (
    <section className="landing-hero">
      <div className="landing-hero-text">
        <p className="landing-eyebrow">No-code IDE for AI</p>
        <h1>Build AI agents and workflows without writing code</h1>
        <p className="landing-lead">
          AIUI is a no-code IDE in your browser for AI workflows, AI agents and teams of agents. Connect Claude, OpenAI or a local model, test
          your flow in the browser, then download it as a complete <strong>Python</strong> or <strong>C#</strong> project that runs anywhere.
        </p>
        <div className="landing-actions">
          <button type="button" className="btn btn-primary btn-lg" onClick={onNewProject}>
            <Plus size={17} /> New project
          </button>
          <button type="button" className="btn btn-default btn-lg" onClick={onTips}>
            <Sparkles size={16} /> Take the tour
          </button>
          <Link to="/docs" className="btn btn-ghost btn-lg">
            <BookOpen size={16} /> Read the guide
          </Link>
        </div>
        <p className="landing-note muted small">
          Look around without an account. You sign in, or create a free account, when you create your project.
        </p>
      </div>
      <figure className="landing-hero-shot">
        <img src="/guide/canvas.webp" alt="An AI agent with a tool on the AIUI canvas" width={1600} height={950} fetchPriority="high" />
      </figure>
    </section>
  );
}

/** More about AIUI, below the templates on Home for guests (and for search engines). */
export function AboutAiui({ onNewProject }: { onNewProject: () => void }) {
  return (
    <div className="landing-info">
      <section className="landing-section" id="what-you-can-build" aria-labelledby="build-title">
        <h2 id="build-title">What you can build</h2>
        <div className="landing-grid landing-grid-3">
          {BUILD.map((b) => (
            <article key={b.title} className="landing-card">
              <span className={`tile tile-${b.tone}`}>
                <b.icon size={20} />
              </span>
              <h3>{b.title}</h3>
              <p>{b.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-section" id="how-it-works" aria-labelledby="how-title">
        <h2 id="how-title">How it works</h2>
        <ol className="landing-steps">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <span className="landing-step-num">{i + 1}</span>
              <div>
                <h3>
                  <s.icon size={17} /> {s.title}
                </h3>
                <p>{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="landing-section" id="features" aria-labelledby="features-title">
        <h2 id="features-title">Features</h2>
        <div className="landing-grid landing-grid-4">
          {FEATURES.map((f) => (
            <article key={f.title} className="landing-feature">
              <f.icon size={20} className="landing-feature-icon" />
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-section" id="screenshots" aria-labelledby="shots-title">
        <h2 id="shots-title">See it in action</h2>
        <div className="landing-grid landing-grid-3">
          {SHOTS.map((s) => (
            <figure key={s.src} className="landing-shot">
              <img src={s.src} alt={s.alt} loading="lazy" width={1600} height={950} />
              <figcaption>{s.caption}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="landing-section" id="faq" aria-labelledby="faq-title">
        <h2 id="faq-title">Questions and answers</h2>
        <div className="landing-faq">
          {LANDING_FAQ.map((f) => (
            <details key={f.q}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="landing-cta">
        <h2>Build your first AI agent in a few minutes</h2>
        <p>Start from a template that runs without any setup, then make it yours.</p>
        <div className="landing-actions">
          <button type="button" className="btn btn-primary btn-lg" onClick={onNewProject}>
            <Plus size={17} /> New project <ArrowRight size={16} />
          </button>
          <Link to="/docs" className="btn btn-default btn-lg">
            <BookOpen size={16} /> Read the guide
          </Link>
        </div>
      </section>
    </div>
  );
}
