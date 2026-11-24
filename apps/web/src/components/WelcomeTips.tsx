import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, BookOpen, Bot, CheckCircle2, PlugZap, Sparkles } from 'lucide-react';
import { api, errorMessage } from '../api';
import { useRunAccess } from '../lib/runAccess';
import { useApp } from '../stores/app';
import { Button, Modal } from './ui';

interface Tip {
  title: string;
  image: string;
  alt: string;
  body: ReactNode;
}

/**
 * Shown once, on a new account's first visit to Home: how to build and run a first AI Agent.
 * `onCreateAgent` opens the New project wizard with the agent template picked.
 */
export function WelcomeTips({ onClose, onCreateAgent }: { onClose: () => void; onCreateAgent: () => void }) {
  const navigate = useNavigate();
  const user = useApp((s) => s.user);
  const impersonating = useApp((s) => !!s.impersonator);
  const connections = useApp((s) => s.connections);
  const access = useRunAccess();
  const [index, setIndex] = useState(0);
  const hasModel = connections.some((c) => c.type === 'llm');

  const addModel = async () => {
    await useApp.getState().openConnectionDialog({ type: 'llm', lockType: true });
    void useApp.getState().loadConnections();
  };

  const tips: Tip[] = [
    {
      title: `Welcome${user ? `, ${user.name.split(' ')[0]}` : ''}! Let's build your first AI Agent`,
      image: '/guide/agent-canvas.webp',
      alt: 'An AI Agent project on the canvas: a chat start step, the agent and its tool',
      body: (
        <>
          <p>
            An <strong>AI Agent</strong> is an assistant that chats with people and uses the <em>tools</em> you give it, like calling an
            API or reading a file. You build it from blocks, no code needed.
          </p>
          <p className="muted">These 4 tips take about two minutes. You can open them again any time from Docs.</p>
        </>
      ),
    },
    {
      title: '1. Add your AI model',
      image: '/guide/connection.webp',
      alt: 'The New connection dialog with the AI model presets',
      body: (
        <>
          <p>
            The agent needs a model to think with. Go to <strong>Connections → New connection → AI model</strong> and pick a preset:
            Claude, OpenAI, OpenRouter, or a model on your own computer (Ollama, LM Studio). Paste your API key if it needs one.
          </p>
          {hasModel ? (
            <p className="tips-ok">
              <CheckCircle2 size={15} /> You already have an AI model connection.
            </p>
          ) : (
            <Button icon={<PlugZap size={15} />} onClick={() => void addModel()}>
              Add an AI model now
            </Button>
          )}
        </>
      ),
    },
    {
      title: '2. Create an AI Agent project',
      image: '/guide/new-agent.webp',
      alt: 'The New project wizard showing the AI Agent templates',
      body: (
        <p>
          On Home, click <strong>New project</strong>, choose <strong>AI Agent</strong>, then the <strong>Agent with a tool</strong> template.
          It already has a chat start step, an agent, and a tool that looks up a to-do item.
        </p>
      ),
    },
    {
      title: '3. Choose the model',
      image: '/guide/agent-model.webp',
      alt: 'The agent step is selected and the AI model field shows "My AI model"',
      body: (
        <p>
          Click the <strong>assistant</strong> step. On the right, set <strong>AI model</strong> to the connection from tip 1. You can
          also change its <em>Role and instructions</em>, the plain-language job description of your agent.
        </p>
      ),
    },
    {
      title: '4. Run it and chat',
      image: '/guide/agent-chat.webp',
      alt: 'The chat panel with a question and the agent answer',
      body: (
        <>
          <p>
            Click <strong>Test chat</strong> at the top, type a question such as <q>What is to-do number 3, and is it done?</q> and press{' '}
            <kbd>Enter</kbd>. Open <strong>Run log</strong> to see every step and tool the agent used.
          </p>
          {!access.canRun && <p className="tips-warn">{access.reason}</p>}
        </>
      ),
    },
  ];

  const last = index === tips.length - 1;
  const tip = tips[index];

  // Closing the tips in any way counts as having seen them (not while an admin looks around as this person).
  const finish = (then?: () => void) => {
    onClose();
    then?.();
    if (impersonating || !useApp.getState().user) return; // guests have no account to remember it in
    void api
      .updateMe({ tipsSeen: true })
      .then((u) => useApp.getState().setUser(u))
      .catch((err) => useApp.getState().toast('error', errorMessage(err)));
  };

  return (
    <Modal
      title={
        <span className="tips-title">
          <Sparkles size={18} /> Getting started
        </span>
      }
      onClose={() => finish()}
      width={720}
      footer={
        <>
          <div className="tips-dots" aria-label={`Tip ${index + 1} of ${tips.length}`}>
            {tips.map((t, i) => (
              <button
                key={t.title}
                type="button"
                className={i === index ? 'active' : ''}
                onClick={() => setIndex(i)}
                aria-label={`Go to tip ${i + 1}`}
              />
            ))}
          </div>
          <span className="grow" />
          {index === 0 ? (
            <Button onClick={() => finish()}>Skip tips</Button>
          ) : (
            <Button icon={<ArrowLeft size={15} />} onClick={() => setIndex(index - 1)}>
              Back
            </Button>
          )}
          {last ? (
            <>
              <Button icon={<BookOpen size={15} />} onClick={() => finish(() => navigate('/docs'))}>
                Open the docs
              </Button>
              <Button variant="primary" icon={<Bot size={15} />} onClick={() => finish(onCreateAgent)}>
                Create my AI Agent
              </Button>
            </>
          ) : (
            <Button variant="primary" onClick={() => setIndex(index + 1)}>
              Next <ArrowRight size={15} />
            </Button>
          )}
        </>
      }
    >
      <div className="tips">
        <img className="tips-image" src={tip.image} alt={tip.alt} />
        <h3>{tip.title}</h3>
        <div className="tips-body">{tip.body}</div>
      </div>
    </Modal>
  );
}
