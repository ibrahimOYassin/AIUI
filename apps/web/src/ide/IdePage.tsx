import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Check, CheckCircle2, ChevronDown, Code, Download, Info, ListOrdered, Loader2, MessageSquare, Play, Redo2, Square, Store, Undo2, Workflow } from 'lucide-react';
import type { NodeTypeInfo } from '@aiui/shared';
import { Badge, Button, ErrorBox, Popover, Spinner } from '../components/ui';
import { PROJECT_TYPES } from '../lib/format';
import { findTrigger, isTrigger, mainPort, outgoing } from '../lib/graph';
import { useRunAccess } from '../lib/runAccess';
import { useApp } from '../stores/app';
import { type IdeMode, useEditor } from '../stores/editor';
import { BottomPanel } from './BottomPanel';
import { Canvas } from './Canvas';
import { CodeView, exportProject } from './CodeView';
import { Guided } from './Guided';
import { Inspector } from './Inspector';
import { StepList } from './StepList';

const MODES: { id: IdeMode; label: string; icon: typeof Code; hint: string }[] = [
  { id: 'guided', label: 'Guided', icon: ListOrdered, hint: 'A simple step-by-step list. Best for getting started.' },
  { id: 'canvas', label: 'Canvas', icon: Workflow, hint: 'A free-form diagram. Best for branches and agents with tools.' },
  { id: 'code', label: 'Code', icon: Code, hint: 'The Python or C# project generated from your steps.' },
];

function ProjectName() {
  const name = useEditor((s) => s.project?.name ?? '');
  const [text, setText] = useState(name);
  useEffect(() => setText(name), [name]);
  const commit = () => {
    if (text.trim()) useEditor.getState().renameProject(text.trim());
    else setText(name);
  };
  return (
    <input
      className="project-name"
      value={text}
      aria-label="Project name"
      title="Click to rename"
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setText(name);
          (e.target as HTMLInputElement).blur();
        }
      }}
      style={{ width: `${Math.max(8, Math.min(40, text.length + 2))}ch` }}
    />
  );
}

function SaveIndicator() {
  const state = useEditor((s) => s.saveState);
  if (state === 'saving' || state === 'dirty') {
    return (
      <span className="save-state">
        <Loader2 size={13} className="spin" /> Saving…
      </span>
    );
  }
  if (state === 'error') {
    return (
      <button type="button" className="save-state error" onClick={() => void useEditor.getState().flushSave()} title="Click to try again">
        <AlertCircle size={13} /> Not saved — retry
      </button>
    );
  }
  return (
    <span className="save-state">
      <Check size={13} /> Saved
    </span>
  );
}

function RunButton() {
  const running = useEditor((s) => s.run.running);
  const isChat = useEditor((s) => s.graph.nodes.some((n) => n.type === 'trigger.chat'));
  const hasSteps = useEditor((s) => s.graph.nodes.length > 0);
  const errorCount = useEditor((s) => s.issues.filter((i) => i.severity === 'error').length);
  const access = useRunAccess();
  const [input, setInput] = useState('{}');
  const [inputError, setInputError] = useState<string | null>(null);

  if (running) {
    return (
      <Button variant="danger" icon={<Square size={14} />} onClick={() => useEditor.getState().stopRun()}>
        Stop
      </Button>
    );
  }
  if (!access.canRun) {
    return (
      <span className="run-locked">
        <Button variant="primary" icon={isChat ? <MessageSquare size={15} /> : <Play size={15} />} disabled title={access.reason}>
          {isChat ? 'Test chat' : 'Run'}
        </Button>
        <Popover
          align="right"
          width={300}
          trigger={(_, toggle) => (
            <button type="button" className="icon-btn" onClick={toggle} aria-label="Why is Run unavailable?" title="Why is Run unavailable?">
              <Info size={16} />
            </button>
          )}
        >
          {() => (
            <div className="pop-pad">
              <strong>Run is not available</strong>
              <p className="muted small">{access.reason}</p>
            </div>
          )}
        </Popover>
      </span>
    );
  }
  if (isChat) {
    return (
      <Button
        variant="primary"
        icon={<MessageSquare size={15} />}
        onClick={() => {
          useEditor.getState().setBottom('chat');
          window.setTimeout(() => document.getElementById('chat-input')?.focus(), 50);
        }}
        title="Open the chat panel to talk to your agent"
      >
        Test chat
      </Button>
    );
  }

  const start = (close: () => void) => {
    let parsed: unknown = {};
    const trimmed = input.trim();
    if (trimmed) {
      try {
        parsed = JSON.parse(trimmed);
      } catch (err) {
        setInputError(err instanceof Error ? err.message : 'Not valid JSON');
        return;
      }
    }
    setInputError(null);
    close();
    useEditor.getState().setBottom('log');
    void useEditor.getState().runProject(parsed);
  };

  return (
    <Popover
      align="right"
      width={340}
      trigger={(_, toggle) => (
        <Button variant="primary" icon={<Play size={15} />} onClick={toggle} disabled={!hasSteps} title={hasSteps ? 'Test the project' : 'Add a step first'}>
          Run
        </Button>
      )}
    >
      {(close) => (
        <div className="pop-pad run-pop">
          <strong>Test input (JSON)</strong>
          <p className="muted small">
            Sent to the trigger and available to steps as <code>{'{{input}}'}</code>. Leave it as <code>{'{}'}</code> if the project needs no
            input.
          </p>
          <textarea
            className="mono"
            rows={5}
            value={input}
            spellCheck={false}
            autoFocus
            onChange={(e) => {
              setInput(e.target.value);
              setInputError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) start(close);
            }}
          />
          {inputError && <div className="field-error">Not valid JSON: {inputError}</div>}
          {errorCount > 0 && (
            <div className="field-error">
              {errorCount} problem{errorCount === 1 ? '' : 's'} may stop the run.{' '}
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  close();
                  useEditor.getState().setBottom('problems');
                }}
              >
                Show
              </button>
            </div>
          )}
          <div className="row-center end">
            <Button variant="primary" icon={<Play size={14} />} onClick={() => start(close)}>
              Run now
            </Button>
          </div>
        </div>
      )}
    </Popover>
  );
}

function TopBar() {
  const project = useEditor((s) => s.project)!;
  const mode = useEditor((s) => s.mode);
  const setMode = useEditor((s) => s.setMode);
  const issueCount = useEditor((s) => s.issues.length);
  const errorCount = useEditor((s) => s.issues.filter((i) => i.severity === 'error').length);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const [exporting, setExporting] = useState<string | null>(null);

  return (
    <header className="topbar">
      <Link to="/" className="icon-btn" title="Back to projects" aria-label="Back to projects">
        <ArrowLeft size={17} />
      </Link>
      <ProjectName />
      <Badge tone={project.type === 'agent' ? 'purple' : project.type === 'solution' ? 'green' : 'blue'}>{PROJECT_TYPES[project.type]?.label ?? project.type}</Badge>
      <SaveIndicator />
      <span className="grow" />
      <div className="segmented mode-switch" role="tablist" aria-label="View mode">
        {MODES.map((m) => (
          <button key={m.id} type="button" role="tab" aria-selected={mode === m.id} className={mode === m.id ? 'active' : ''} onClick={() => setMode(m.id)} title={m.hint}>
            <m.icon size={14} /> {m.label}
          </button>
        ))}
      </div>
      <span className="grow" />
      {mode !== 'canvas' && mode !== 'code' && (
        <>
          <button type="button" className="icon-btn" disabled={!canUndo} onClick={() => useEditor.getState().undo()} title="Undo (Ctrl+Z)">
            <Undo2 size={16} />
          </button>
          <button type="button" className="icon-btn" disabled={!canRedo} onClick={() => useEditor.getState().redo()} title="Redo (Ctrl+Shift+Z)">
            <Redo2 size={16} />
          </button>
        </>
      )}
      <button
        type="button"
        className={`problems-btn ${errorCount ? 'error' : issueCount ? 'warning' : 'ok'}`}
        onClick={() => useEditor.getState().setBottom('problems')}
        title="Show problems"
      >
        {issueCount === 0 ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
        {issueCount === 0 ? 'No problems' : `${issueCount} problem${issueCount === 1 ? '' : 's'}`}
      </button>
      <RunButton />
      <Popover
        align="right"
        width={240}
        trigger={(_, toggle) => (
          <Button icon={<Download size={15} />} onClick={toggle} busy={exporting !== null}>
            Export <ChevronDown size={13} />
          </Button>
        )}
      >
        {(close) => (
          <div className="menu">
            {(['python', 'csharp'] as const).map((lang) => (
              <button
                key={lang}
                type="button"
                onClick={() => {
                  close();
                  setExporting(lang);
                  void exportProject(lang).finally(() => setExporting(null));
                }}
              >
                <Download size={14} />
                <span>
                  {lang === 'python' ? 'Python project (.zip)' : 'C# project (.zip)'}
                  <small>{lang === 'python' ? 'Run with: python main.py' : 'Run with: dotnet run'}</small>
                </span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                close();
                setMode('code');
              }}
            >
              <Code size={14} />
              <span>
                Preview the code
                <small>Open Code mode</small>
              </span>
            </button>
          </div>
        )}
      </Popover>
    </header>
  );
}

/** Add a step from the library by click. In Guided mode it joins the end of the flow. */
function addFromLibrary(def: NodeTypeInfo) {
  const ed = useEditor.getState();
  const types = useApp.getState().nodeTypes;
  if (ed.mode !== 'guided' || isTrigger(def)) {
    ed.addStep(def);
    return;
  }
  const selected = ed.graph.nodes.find((n) => n.id === ed.selectedId);
  if (selected) {
    const port = mainPort(types.get(selected.type)) ?? types.get(selected.type)?.outputs[0]?.id;
    if (port) {
      ed.insertStep(def, selected.id, port);
      return;
    }
  }
  const trigger = findTrigger(ed.graph, types);
  if (!trigger) {
    ed.addStep(def);
    return;
  }
  // walk to the end of the main chain
  let cursor = trigger;
  const seen = new Set<string>();
  for (;;) {
    seen.add(cursor.id);
    const port = mainPort(types.get(cursor.type));
    if (!port) break;
    const next = outgoing(ed.graph, cursor.id, port)[0];
    const node = next ? ed.graph.nodes.find((n) => n.id === next.target) : undefined;
    if (!node || seen.has(node.id)) break;
    cursor = node;
  }
  const port = mainPort(types.get(cursor.type)) ?? types.get(cursor.type)?.outputs[0]?.id ?? 'out';
  ed.insertStep(def, cursor.id, port);
}

function Library() {
  const mode = useEditor((s) => s.mode);
  return (
    <aside className="library">
      <div className="library-head">
        <strong>Step library</strong>
        <span className="muted small">{mode === 'canvas' ? 'Click or drag to add' : 'Click to add after the selected step'}</span>
      </div>
      <StepList draggable={mode === 'canvas'} onPick={addFromLibrary} />
      <Link to="/marketplace" className="library-foot">
        <Store size={14} /> Get more steps
      </Link>
    </aside>
  );
}

export function IdePage() {
  const { id = '' } = useParams();
  const project = useEditor((s) => s.project);
  const loading = useEditor((s) => s.loading);
  const loadError = useEditor((s) => s.loadError);
  const mode = useEditor((s) => s.mode);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    void useEditor.getState().load(id);
    return () => {
      mounted.current = false;
      useEditor.getState().unload();
    };
  }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === 's') {
        e.preventDefault();
        void useEditor.getState().flushSave();
        return;
      }
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
      if (typing) return;
      if (key === 'z') {
        e.preventDefault();
        if (e.shiftKey) useEditor.getState().redo();
        else useEditor.getState().undo();
      } else if (key === 'y') {
        e.preventDefault();
        useEditor.getState().redo();
      }
    };
    window.addEventListener('keydown', onKey);
    const onUnload = () => void useEditor.getState().flushSave();
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, []);

  if (loadError) {
    return (
      <div className="page">
        <Link to="/" className="back-link">
          <ArrowLeft size={14} /> Projects
        </Link>
        <ErrorBox message={loadError} onRetry={() => void useEditor.getState().load(id)} />
      </div>
    );
  }
  if (loading || !project) {
    return (
      <div className="page">
        <Spinner label="Opening project…" />
      </div>
    );
  }

  return (
    <div className="ide">
      <TopBar />
      <div className="ide-body">
        {mode !== 'code' && <Library />}
        <div className="ide-center">
          <div className="ide-view">
            {mode === 'canvas' ? (
              <Canvas />
            ) : mode === 'guided' ? (
              <Guided />
            ) : (
              <CodeView />
            )}
          </div>
          <BottomPanel />
        </div>
        {mode !== 'code' && <Inspector />}
      </div>
    </div>
  );
}
