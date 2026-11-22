import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, CircleDot, Eraser, Info, Loader2, MessageSquare, Play, Send, Square, TerminalSquare, XCircle } from 'lucide-react';
import type { RunEvent } from '@aiui/shared';
import { ms, preview, pretty } from '../lib/format';
import { useRunAccess } from '../lib/runAccess';
import { type BottomTab, useEditor } from '../stores/editor';

function EventRow({ event }: { event: RunEvent }) {
  const [open, setOpen] = useState(false);
  const select = useEditor((s) => s.select);
  switch (event.type) {
    case 'run_start':
      return (
        <div className="log-row info">
          <Play size={13} />
          <span>Run started</span>
        </div>
      );
    case 'node_start':
      return (
        <div className="log-row muted clickable" onClick={() => select(event.nodeId)}>
          <CircleDot size={13} />
          <span>
            <code>{event.name}</code> started
          </span>
        </div>
      );
    case 'node_end': {
      const hasOutput = event.output !== undefined && event.output !== null;
      return (
        <div className="log-row success">
          <CheckCircle2 size={13} />
          <div className="grow">
            <span className="clickable" onClick={() => select(event.nodeId)}>
              <code>{event.name}</code> finished in {ms(event.ms)}
              {event.port && event.port !== 'out' ? ` → ${event.port}` : ''}
            </span>
            {hasOutput && (
              <button type="button" className="log-toggle" onClick={() => setOpen(!open)}>
                {open ? 'Hide result' : preview(event.output, 110)}
              </button>
            )}
            {open && <pre className="output-json">{pretty(event.output)}</pre>}
          </div>
        </div>
      );
    }
    case 'node_error':
      return (
        <div className="log-row error clickable" onClick={() => select(event.nodeId)}>
          <XCircle size={13} />
          <span>
            <code>{event.name}</code> failed: {event.error}
          </span>
        </div>
      );
    case 'log':
      return (
        <div className={`log-row ${event.level === 'error' ? 'error' : event.level === 'warn' ? 'warn' : 'plain'}`}>
          {event.level === 'error' ? <AlertCircle size={13} /> : event.level === 'warn' ? <AlertTriangle size={13} /> : <Info size={13} />}
          <span className="prewrap">{event.message}</span>
        </div>
      );
    case 'stdout':
      return (
        <div className="log-row plain mono">
          <span />
          <span className="prewrap">{event.text}</span>
        </div>
      );
    case 'run_end':
      return (
        <div className={`log-row end ${event.status}`}>
          {event.status === 'success' ? <CheckCircle2 size={14} /> : event.status === 'stopped' ? <Square size={13} /> : <XCircle size={14} />}
          <div className="grow">
            <strong>
              {event.status === 'success' ? 'Run finished' : event.status === 'stopped' ? 'Run stopped' : 'Run failed'}
              {event.ms ? ` in ${ms(event.ms)}` : ''}
            </strong>
            {event.error && <div className="prewrap">{event.error}</div>}
            {event.status === 'success' && event.output !== undefined && event.output !== null && (
              <>
                <button type="button" className="log-toggle" onClick={() => setOpen(!open)}>
                  {open ? 'Hide final result' : `Final result: ${preview(event.output, 100)}`}
                </button>
                {open && <pre className="output-json">{pretty(event.output)}</pre>}
              </>
            )}
          </div>
        </div>
      );
    default:
      return null;
  }
}

function RunLog() {
  const events = useEditor((s) => s.run.events);
  const running = useEditor((s) => s.run.running);
  const { canRun: allowRun, reason: lockedReason } = useRunAccess();
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [events.length]);

  if (events.length === 0 && !running) {
    return (
      <div className="panel-empty">
        <TerminalSquare size={20} />
        <p>
          {allowRun
            ? 'Press Run to test the project. Each step lights up as it runs, and its result appears here.'
            : lockedReason}
        </p>
      </div>
    );
  }
  return (
    <div className="log">
      {events.map((e, i) => (
        <EventRow key={i} event={e} />
      ))}
      {running && (
        <div className="log-row muted">
          <Loader2 size={13} className="spin" />
          <span>Running…</span>
        </div>
      )}
      <div ref={end} />
    </div>
  );
}

function Chat() {
  const chat = useEditor((s) => s.chat);
  const running = useEditor((s) => s.run.running);
  const { canRun: allowRun, reason: lockedReason } = useRunAccess();
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [chat.length, running]);

  const send = (e?: FormEvent) => {
    e?.preventDefault();
    const message = text.trim();
    if (!message || running || !allowRun) return;
    setText('');
    void useEditor.getState().sendChat(message);
    input.current?.focus();
  };

  return (
    <div className="chat">
      <div className="chat-scroll">
        {chat.length === 0 && (
          <div className="panel-empty">
            <MessageSquare size={20} />
            <p>
              {allowRun
                ? 'Say something to test your agent. Each message runs the project and the reply appears here.'
                : lockedReason}
            </p>
          </div>
        )}
        {chat.map((turn, i) => (
          <div key={i} className={`bubble ${turn.role}`}>
            <div className="bubble-text prewrap">{turn.content}</div>
          </div>
        ))}
        {running && (
          <div className="bubble assistant typing">
            <Loader2 size={14} className="spin" /> Thinking…
          </div>
        )}
        <div ref={end} />
      </div>
      <form className="chat-input" onSubmit={send}>
        <textarea
          ref={input}
          id="chat-input"
          rows={1}
          value={text}
          placeholder={allowRun ? 'Type a message…' : 'Running is not available for your account'}
          disabled={!allowRun}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        {running ? (
          <button type="button" className="btn btn-default btn-md" onClick={() => useEditor.getState().stopRun()}>
            <Square size={14} />
            <span>Stop</span>
          </button>
        ) : (
          <button type="submit" className="btn btn-primary btn-md" disabled={!text.trim() || !allowRun}>
            <Send size={14} />
            <span>Send</span>
          </button>
        )}
        {chat.length > 0 && !running && (
          <button type="button" className="icon-btn" title="Clear the conversation" onClick={() => useEditor.getState().clearChat()}>
            <Eraser size={15} />
          </button>
        )}
      </form>
    </div>
  );
}

function Problems() {
  const issues = useEditor((s) => s.issues);
  const nodes = useEditor((s) => s.graph.nodes);
  const sorted = useMemo(() => [...issues].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1)), [issues]);

  if (sorted.length === 0) {
    return (
      <div className="panel-empty">
        <CheckCircle2 size={20} className="status-icon success" />
        <p>No problems found. The project is ready to run.</p>
      </div>
    );
  }
  return (
    <div className="log">
      {sorted.map((issue, i) => {
        const node = issue.nodeId ? nodes.find((n) => n.id === issue.nodeId) : undefined;
        return (
          <div
            key={i}
            className={`log-row problem ${issue.severity === 'error' ? 'error' : 'warn'} ${node ? 'clickable' : ''}`}
            onClick={() => {
              if (!node) return;
              const ed = useEditor.getState();
              if (ed.mode === 'code') ed.setMode('canvas');
              ed.select(node.id, issue.field ?? null);
            }}
          >
            {issue.severity === 'error' ? <AlertCircle size={14} /> : <AlertTriangle size={14} />}
            <span className="grow">{issue.message}</span>
            {node && (
              <span className="fix-link">
                <code>{node.name}</code> · Fix
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function BottomPanel() {
  const open = useEditor((s) => s.bottomOpen);
  const tab = useEditor((s) => s.bottomTab);
  const setBottom = useEditor((s) => s.setBottom);
  const toggle = useEditor((s) => s.toggleBottom);
  const isChat = useEditor((s) => s.graph.nodes.some((n) => n.type === 'trigger.chat'));
  const issueCount = useEditor((s) => s.issues.length);
  const errorCount = useEditor((s) => s.issues.filter((i) => i.severity === 'error').length);
  const running = useEditor((s) => s.run.running);
  const runEnd = useEditor((s) => s.run.end);

  const tabs: { id: BottomTab; label: string }[] = [
    ...(isChat ? [{ id: 'chat' as const, label: 'Chat test' }] : []),
    { id: 'log', label: 'Run log' },
    { id: 'problems', label: 'Problems' },
  ];
  const active: BottomTab = tab === 'chat' && !isChat ? 'log' : tab;

  return (
    <section className={`bottom ${open ? 'open' : ''}`}>
      <div className="bottom-head">
        {tabs.map((t) => (
          <button key={t.id} type="button" className={`bottom-tab ${open && active === t.id ? 'active' : ''}`} onClick={() => setBottom(t.id, !(open && active === t.id))}>
            {t.label}
            {t.id === 'problems' && issueCount > 0 && <span className={`tab-count ${errorCount ? 'error' : 'warning'}`}>{issueCount}</span>}
            {t.id === 'log' && running && <Loader2 size={12} className="spin" />}
            {t.id === 'log' && !running && runEnd && <span className={`dot ${runEnd.status}`} />}
          </button>
        ))}
        <span className="grow" onClick={toggle} />
        <button type="button" className="icon-btn" onClick={toggle} title={open ? 'Hide panel' : 'Show panel'} aria-label={open ? 'Hide panel' : 'Show panel'}>
          {open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
      </div>
      {open && <div className="bottom-body">{active === 'chat' ? <Chat /> : active === 'problems' ? <Problems /> : <RunLog />}</div>}
    </section>
  );
}
