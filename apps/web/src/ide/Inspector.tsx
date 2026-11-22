import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, AlertTriangle, CheckCircle2, MousePointerClick, Plus, Trash2, Wrench, XCircle } from 'lucide-react';
import type { FlowNode, Graph, NodeTypeInfo, ToolParam } from '@aiui/shared';
import { RESERVED_NAMES, slugify, uniqueName } from '@aiui/shared';
import { FieldsForm, type VarGroup } from '../components/FieldForm';
import { Button, Tabs } from '../components/ui';
import { pretty } from '../lib/format';
import { type TypeMap, isLinkedAsTool, isTrigger, isValidName, upstream } from '../lib/graph';
import { Icon, KIND_LABEL } from '../lib/icons';
import { useApp } from '../stores/app';
import { useEditor } from '../stores/editor';

/** What the "Insert data" picker offers for a given step. */
function variableGroups(graph: Graph, node: FlowNode, types: TypeMap): VarGroup[] {
  const { ids, inLoop, isTool } = upstream(graph, node.id);
  const groups: VarGroup[] = [];
  const nodes = graph.nodes.filter((n) => ids.has(n.id));
  const vars = new Set<string>();

  if (isTool) {
    const params = node.tool?.params ?? [];
    groups.push({
      label: 'From the agent (tool arguments)',
      items: params.length
        ? params.filter((p) => p.name).map((p) => ({ ref: `args.${p.name}`, label: p.description || p.name }))
        : [{ ref: 'args', label: 'All arguments (add parameters under Tool settings)' }],
    });
  }
  if (inLoop) {
    groups.push({
      label: 'Current loop item',
      items: [
        { ref: 'item', label: 'Current item' },
        { ref: 'index', label: 'Position of the item (starts at 0)' },
      ],
    });
  }
  for (const n of nodes) {
    const def = types.get(n.type);
    if (isTrigger(def)) {
      const items = [{ ref: 'input', label: 'Everything the trigger received' }];
      for (const f of def?.outputFields ?? []) items.push({ ref: `input.${f.key}`, label: f.label });
      groups.push({ label: `Trigger: ${def?.label ?? n.name}`, items });
      continue;
    }
    // "Set variables" style steps contribute {{vars.*}}
    for (const value of Object.values(n.config)) {
      if (n.type.includes('set') && value && typeof value === 'object' && !Array.isArray(value)) {
        for (const key of Object.keys(value)) vars.add(key);
      }
    }
    const items = [{ ref: n.name, label: 'Whole result' }];
    for (const f of def?.outputFields ?? []) items.push({ ref: `${n.name}.${f.key}`, label: f.label });
    groups.push({ label: `${def?.label ?? n.type} (${n.name})`, items });
  }
  if (vars.size) {
    groups.push({ label: 'Variables', items: [...vars].map((v) => ({ ref: `vars.${v}`, label: v })) });
  }
  return groups;
}

function NameField({ node }: { node: FlowNode }) {
  const [text, setText] = useState(node.name);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setText(node.name);
    setError(null);
  }, [node.id, node.name]);

  const commit = () => {
    const slug = slugify(text);
    if (slug === node.name) {
      setText(node.name);
      setError(null);
      return;
    }
    if (!isValidName(slug)) {
      setError(RESERVED_NAMES.includes(slug) ? `"${slug}" is reserved. Choose another name.` : 'Use letters, numbers and underscores, starting with a letter.');
      return;
    }
    const others = useEditor
      .getState()
      .graph.nodes.filter((n) => n.id !== node.id)
      .map((n) => n.name);
    const final = uniqueName(slug, [...others, ...RESERVED_NAMES]);
    useEditor.getState().rename(node.id, final);
    setText(final);
    setError(null);
  };

  return (
    <div className={`field ${error ? 'field-problem' : ''}`}>
      <div className="field-label">
        <label>Step name</label>
      </div>
      <input
        type="text"
        className="mono"
        value={text}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
      {error && <div className="field-error">{error}</div>}
      <div className="field-help">
        Other steps use this name to read its result, e.g. <code>{`{{${slugify(text) || node.name}}}`}</code>. Renaming updates them
        automatically.
      </div>
    </div>
  );
}

function ToolSettings({ node }: { node: FlowNode }) {
  const tool = node.tool ?? { description: '', params: [] };
  const update = (patch: Partial<NonNullable<FlowNode['tool']>>) =>
    useEditor.getState().updateNode(node.id, { tool: { ...tool, ...patch } }, `tool:${node.id}`);
  const setParam = (i: number, patch: Partial<ToolParam>) => update({ params: tool.params.map((p, j) => (j === i ? { ...p, ...patch } : p)) });

  return (
    <section className="insp-section tool-settings">
      <h4>
        <Wrench size={14} /> Tool settings
      </h4>
      <p className="muted small">An agent can call this step as a tool. Tell the agent what it does and what it needs.</p>
      <div className="fields">
        <div className={`field ${tool.description.trim() ? '' : 'field-warn'}`}>
          <div className="field-label">
            <label>
              What this tool does<span className="req">*</span>
            </label>
          </div>
          <textarea rows={2} value={tool.description} placeholder="e.g. Looks up the current weather for a city." onChange={(e) => update({ description: e.target.value })} />
          <div className="field-help">The agent reads this to decide when to use the tool.</div>
        </div>
        <div className="field">
          <div className="field-label">
            <label>Information the agent provides</label>
          </div>
          <div className="rows">
            {tool.params.map((p, i) => (
              <div key={i} className="param">
                <div className="row">
                  <input
                    type="text"
                    className="mono"
                    placeholder="name"
                    value={p.name}
                    spellCheck={false}
                    onChange={(e) => setParam(i, { name: e.target.value.replace(/[^A-Za-z0-9_]/g, '_') })}
                  />
                  <select value={p.type} onChange={(e) => setParam(i, { type: e.target.value as ToolParam['type'] })}>
                    <option value="string">Text</option>
                    <option value="number">Number</option>
                    <option value="boolean">Yes / No</option>
                  </select>
                  <button type="button" className="icon-btn" aria-label="Remove parameter" onClick={() => update({ params: tool.params.filter((_, j) => j !== i) })}>
                    <Trash2 size={14} />
                  </button>
                </div>
                <input type="text" placeholder="Describe it, e.g. Name of the city" value={p.description} onChange={(e) => setParam(i, { description: e.target.value })} />
                <label className="check small">
                  <input type="checkbox" checked={p.required !== false} onChange={(e) => setParam(i, { required: e.target.checked })} /> Required
                  {p.name && (
                    <span className="muted">
                      {' '}
                      · use it as <code>{`{{args.${p.name}}}`}</code>
                    </span>
                  )}
                </label>
              </div>
            ))}
            <button type="button" className="link-btn" onClick={() => update({ params: [...tool.params, { name: '', type: 'string', description: '', required: true }] })}>
              <Plus size={13} /> Add parameter
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function LastOutput({ node }: { node: FlowNode }) {
  const status = useEditor((s) => s.run.status[node.id]);
  const output = useEditor((s) => s.run.outputs[node.id]);
  const hasOutput = useEditor((s) => node.id in s.run.outputs);
  const error = useEditor((s) => s.run.errors[node.id]);
  const anyRun = useEditor((s) => s.run.events.length > 0);

  if (!status && !error && !hasOutput) {
    return (
      <div className="insp-empty">
        <p className="muted">{anyRun ? 'This step did not run in the last test.' : 'Run the project to see what this step produces.'}</p>
      </div>
    );
  }
  return (
    <div className="last-output">
      <div className="row-center">
        {status === 'success' && (
          <>
            <CheckCircle2 size={15} className="status-icon success" /> <strong>Finished</strong>
          </>
        )}
        {status === 'error' && (
          <>
            <XCircle size={15} className="status-icon error" /> <strong>Failed</strong>
          </>
        )}
        {status === 'running' && <strong>Running…</strong>}
      </div>
      {error && <div className="output-error">{error}</div>}
      {hasOutput && (
        <>
          <div className="field-help">
            Result, available to later steps as <code>{`{{${node.name}}}`}</code>
          </div>
          <pre className="output-json">{pretty(output)}</pre>
        </>
      )}
    </div>
  );
}

function StepInspector({ node, def }: { node: FlowNode; def: NodeTypeInfo }) {
  const graph = useEditor((s) => s.graph);
  const issues = useEditor((s) => s.issues);
  const focusField = useEditor((s) => s.focusField);
  const types = useApp((s) => s.nodeTypes);
  const runStatus = useEditor((s) => s.run.status[node.id]);
  const [tab, setTab] = useState<'settings' | 'output'>('settings');

  useEffect(() => setTab('settings'), [node.id]);
  useEffect(() => {
    if (focusField) setTab('settings');
  }, [focusField]);

  const variables = useMemo(() => variableGroups(graph, node, types), [graph, node, types]);
  const asTool = useMemo(() => isLinkedAsTool(graph, node.id), [graph, node.id]);
  const nodeIssues = issues.filter((i) => i.nodeId === node.id);
  const problems: Record<string, string> = {};
  for (const i of nodeIssues) if (i.field && !problems[i.field]) problems[i.field] = i.message;
  const general = nodeIssues.filter((i) => !i.field || !def.fields.some((f) => f.key === i.field));

  return (
    <>
      <header className="insp-head">
        <span className={`tile kind-${def.kind}`}>
          <Icon name={def.icon} size={18} />
        </span>
        <div className="grow">
          <strong>{def.label}</strong>
          <div className="muted small">
            {KIND_LABEL[def.kind]} · {def.pluginName}
          </div>
        </div>
        <button type="button" className="icon-btn" title="Delete step" aria-label="Delete step" onClick={() => useEditor.getState().remove([node.id], [], true)}>
          <Trash2 size={16} />
        </button>
      </header>
      <p className="insp-desc muted small">{def.description}</p>
      <Tabs
        tabs={[
          { id: 'settings', label: 'Settings', count: nodeIssues.length },
          { id: 'output', label: runStatus === 'error' ? 'Last output ⚠' : 'Last output' },
        ]}
        value={tab}
        onChange={setTab}
      />
      <div className="insp-body">
        {tab === 'output' ? (
          <LastOutput node={node} />
        ) : (
          <>
            {general.map((i, idx) => (
              <div key={idx} className={`insp-issue ${i.severity}`}>
                {i.severity === 'error' ? <AlertCircle size={14} /> : <AlertTriangle size={14} />}
                <span>{i.message}</span>
              </div>
            ))}
            <div className="fields">
              <NameField node={node} />
            </div>
            {def.fields.length === 0 ? (
              <p className="muted small">This step has no settings.</p>
            ) : (
              <FieldsForm
                key={node.id}
                fields={def.fields}
                values={node.config}
                onChange={(key, value) => useEditor.getState().updateConfig(node.id, key, value)}
                variables={variables}
                problems={problems}
                focusField={focusField}
                resetKey={node.id}
              />
            )}
            {asTool && <ToolSettings node={node} />}
            {!isTrigger(def) && (
              <section className="insp-section">
                <div className="fields">
                  <div className="field">
                    <div className="field-label">
                      <label>If this step fails</label>
                    </div>
                    <select value={node.onError ?? 'stop'} onChange={(e) => useEditor.getState().updateNode(node.id, { onError: e.target.value as 'stop' | 'continue' })}>
                      <option value="stop">Stop the run (recommended)</option>
                      <option value="continue">Continue with the next step</option>
                    </select>
                  </div>
                  <div className="field">
                    <div className="field-label">
                      <label>Notes</label>
                    </div>
                    <textarea
                      rows={2}
                      value={node.notes ?? ''}
                      placeholder="A reminder for yourself or teammates (optional)"
                      onChange={(e) => useEditor.getState().updateNode(node.id, { notes: e.target.value || undefined }, `notes:${node.id}`)}
                    />
                  </div>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </>
  );
}

export function Inspector() {
  const node = useEditor((s) => s.graph.nodes.find((n) => n.id === s.selectedId));
  const def = useApp((s) => (node ? s.nodeTypes.get(node.type) : undefined));
  const stepCount = useEditor((s) => s.graph.nodes.length);
  const mode = useEditor((s) => s.mode);

  if (!node) {
    return (
      <aside className="inspector">
        <div className="insp-empty">
          <MousePointerClick size={22} />
          <h4>{stepCount === 0 ? 'Nothing here yet' : 'Select a step'}</h4>
          <p className="muted small">
            {stepCount === 0
              ? 'Choose how the project starts, then add steps. Their settings appear here.'
              : `Click a step ${mode === 'canvas' ? 'on the canvas' : 'in the list'} to change its settings.`}
          </p>
          <ul className="tips muted small">
            <li>
              Use <strong>Insert data</strong> on a field to reuse the result of an earlier step.
            </li>
            <li>
              Press <kbd>Ctrl</kbd>+<kbd>K</kbd> to add a step by name.
            </li>
            <li>
              <kbd>Ctrl</kbd>+<kbd>Z</kbd> undoes any change.
            </li>
          </ul>
        </div>
      </aside>
    );
  }

  if (!def) {
    return (
      <aside className="inspector">
        <header className="insp-head">
          <span className="tile">
            <AlertTriangle size={18} />
          </span>
          <div className="grow">
            <strong>Plugin not installed</strong>
            <div className="muted small">
              <code>{node.type}</code>
            </div>
          </div>
        </header>
        <div className="insp-body">
          <p className="muted small">
            This step comes from a plugin that is not installed or is disabled. Your settings are kept; install the plugin to edit and run
            the step again.
          </p>
          <div className="row-center wrap">
            <Link to="/marketplace" className="btn btn-primary btn-sm">
              <span>Open Marketplace</span>
            </Link>
            <Button size="sm" icon={<Trash2 size={14} />} onClick={() => useEditor.getState().remove([node.id], [], true)}>
              Delete step
            </Button>
          </div>
          <pre className="output-json">{pretty(node.config)}</pre>
        </div>
      </aside>
    );
  }

  return (
    <aside className="inspector">
      <StepInspector node={node} def={def} />
    </aside>
  );
}
