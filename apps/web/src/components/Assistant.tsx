import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { create } from 'zustand';
import { ArrowUp, Check, LoaderCircle, MessageSquarePlus, Sparkles, Square, X } from 'lucide-react';
import type { AssistantMessage } from '@aiui/shared';
import { errorMessage, streamAssistant } from '../api';
import { Markdown } from '../lib/markdown';
import { useApp } from '../stores/app';
import { useEditor } from '../stores/editor';

/** Whether the panel is open; the rail button and the command palette both toggle it. */
export const useAssistantPanel = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

interface Turn extends AssistantMessage {
  /** What the assistant looked up while answering. */
  tools?: string[];
  error?: string;
}

const MAX_KEPT = 40;
const storageKey = (userId: string | null) => `aiui.assistant.${userId ?? 'guest'}`;

function loadTurns(userId: string | null): Turn[] {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(userId)) ?? '[]') as Turn[];
    return Array.isArray(raw) ? raw.filter((t) => (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string') : [];
  } catch {
    return [];
  }
}

function saveTurns(userId: string | null, turns: Turn[]) {
  try {
    if (turns.length) localStorage.setItem(storageKey(userId), JSON.stringify(turns.slice(-MAX_KEPT)));
    else localStorage.removeItem(storageKey(userId));
  } catch {
    /* storage unavailable: the conversation lasts until the page reloads */
  }
}

const narrow = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches;

export function AssistantPanel() {
  const info = useApp((s) => s.config?.assistant ?? null);
  const user = useApp((s) => s.user);
  const userId = user?.id ?? null;
  const { open, setOpen } = useAssistantPanel();
  const location = useLocation();
  const project = useEditor((s) => s.project);
  const projectId = project && location.pathname.startsWith(`/projects/${project.id}`) ? project.id : undefined;

  const [turns, setTurns] = useState<Turn[]>(() => loadTurns(userId));
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Each account (and guests) has its own conversation.
  useEffect(() => {
    abortRef.current?.abort();
    setTurns(loadTurns(userId));
    setRemaining(null);
  }, [userId]);

  useEffect(() => {
    if (!busy) saveTurns(userId, turns);
  }, [turns, busy, userId]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [turns]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && !useApp.getState().paletteOpen) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!info || (!user && !info.guests) || !open) return null;

  const update = (change: (last: Turn) => Turn) =>
    setTurns((current) => [...current.slice(0, -1), change(current[current.length - 1])]);

  const ask = async (question: string) => {
    const text = question.trim();
    if (!text || busy) return;
    const history = turns.filter((t) => !t.error && t.content.trim()).map(({ role, content }) => ({ role, content }));
    setTurns([...turns, { role: 'user', content: text }, { role: 'assistant', content: '', tools: [] }]);
    setDraft('');
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const events = streamAssistant({ messages: [...history, { role: 'user', content: text }], projectId, page: location.pathname }, controller.signal);
      for await (const event of events) {
        if (event.type === 'text') update((last) => ({ ...last, content: last.content + event.text }));
        else if (event.type === 'tool') update((last) => ({ ...last, tools: [...(last.tools ?? []), event.label] }));
        else if (event.type === 'error') update((last) => ({ ...last, error: event.message }));
        else if (event.type === 'done') setRemaining(event.remaining);
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) update((last) => ({ ...last, error: errorMessage(err) }));
    } finally {
      abortRef.current = null;
      setBusy(false);
      // An answer that never started is dropped, so the question can be asked again.
      setTurns((current) => {
        const last = current[current.length - 1];
        return last?.role === 'assistant' && !last.content.trim() && !last.error ? current.slice(0, -1) : current;
      });
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void ask(draft);
    }
  };

  const newChat = () => {
    abortRef.current?.abort();
    setTurns([]);
    inputRef.current?.focus();
  };

  const closeOnPhone = () => {
    if (narrow()) setOpen(false);
  };

  const suggestions = [
    ...(projectId ? ['What does this project do?', 'Are there any problems in this project?'] : []),
    ...(user && !projectId ? ['Summarize my projects', 'Which of my projects use an AI model?'] : []),
    'How do I build a chat agent that can use tools?',
    'How do I connect a Telegram bot?',
  ].slice(0, 4);

  return (
    <aside className="assistant" aria-label={info.name}>
      <header className="assistant-head">
        <span className="assistant-mark" aria-hidden>
          <Sparkles size={16} />
        </span>
        <strong className="assistant-title">{info.name}</strong>
        <button type="button" className="icon-btn" onClick={newChat} title="New conversation" aria-label="New conversation" disabled={!turns.length && !busy}>
          <MessageSquarePlus size={17} />
        </button>
        <button type="button" className="icon-btn" onClick={() => setOpen(false)} title="Close (Esc)" aria-label="Close the assistant">
          <X size={18} />
        </button>
      </header>

      <div className="assistant-list" ref={listRef} aria-live="polite">
        <div className="assistant-msg assistant-msg-bot">
          <div className="assistant-bubble">
            <Markdown text={info.greeting || 'Hi! How can I help?'} onNavigate={closeOnPhone} />
            {!user && (
              <p className="muted small">
                As a guest I can answer questions about AIUI. <Link to="/signin" state={{ from: location.pathname }} onClick={closeOnPhone}>Sign in</Link> so I can
                help with your own projects too.
              </p>
            )}
          </div>
        </div>

        {turns.map((turn, n) =>
          turn.role === 'user' ? (
            <div key={n} className="assistant-msg assistant-msg-user">
              <div className="assistant-bubble">{turn.content}</div>
            </div>
          ) : (
            <div key={n} className="assistant-msg assistant-msg-bot">
              <div className="assistant-bubble">
                {!!turn.tools?.length && (
                  <ul className="assistant-tools">
                    {turn.tools.map((label, i) => {
                      const working = busy && n === turns.length - 1 && i === turn.tools!.length - 1 && !turn.content;
                      return (
                        <li key={i}>
                          {working ? <LoaderCircle size={13} className="spin" /> : <Check size={13} />} {label}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {turn.content && <Markdown text={turn.content} onNavigate={closeOnPhone} />}
                {busy && n === turns.length - 1 && !turn.content && !turn.tools?.length && (
                  <span className="assistant-typing" aria-label="Thinking">
                    <i />
                    <i />
                    <i />
                  </span>
                )}
                {turn.error && <p className="assistant-error">{turn.error}</p>}
              </div>
            </div>
          ),
        )}

        {!turns.length && (
          <div className="assistant-suggestions">
            {suggestions.map((s) => (
              <button key={s} type="button" onClick={() => void ask(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      <form
        className="assistant-input"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(draft);
        }}
      >
        <textarea
          ref={inputRef}
          value={draft}
          rows={1}
          maxLength={8000}
          placeholder={projectId ? 'Ask about this project or about AIUI…' : 'Ask anything about AIUI…'}
          aria-label="Your question"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {busy ? (
          <button type="button" className="assistant-send" onClick={() => abortRef.current?.abort()} title="Stop" aria-label="Stop the answer">
            <Square size={14} fill="currentColor" />
          </button>
        ) : (
          <button type="submit" className="assistant-send" disabled={!draft.trim()} title="Send (Enter)" aria-label="Send">
            <ArrowUp size={17} />
          </button>
        )}
      </form>
      <p className="assistant-foot">
        {remaining !== null && remaining <= 10 ? `${remaining} question${remaining === 1 ? '' : 's'} left today. ` : ''}
        {user ? 'It can read your projects, never anyone else’s.' : 'Answers can be wrong; check the Docs when unsure.'}
      </p>
    </aside>
  );
}

/** The rail button that opens and closes the assistant. Hidden while it is off or not open to this visitor. */
export function AssistantRailButton() {
  const info = useApp((s) => s.config?.assistant ?? null);
  const signedIn = useApp((s) => !!s.user);
  const { open, setOpen } = useAssistantPanel();
  if (!info || (!signedIn && !info.guests)) return null;
  return (
    <button type="button" className={`rail-item ${open ? 'active' : ''}`} onClick={() => setOpen(!open)} title={`${info.name} (Ctrl+J)`} aria-pressed={open}>
      <Sparkles size={19} />
      <span>Assistant</span>
    </button>
  );
}
