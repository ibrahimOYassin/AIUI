import { Fragment, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, CornerDownRight, Loader2, Plus, Trash2, Workflow, XCircle } from 'lucide-react';
import type { FlowNode, Graph, NodeTypeInfo } from '@aiui/shared';
import { Popover } from '../components/ui';
import { preview } from '../lib/format';
import { TOOLS_PORT, type TypeMap, branchPorts, isTrigger, mainPort, outgoing } from '../lib/graph';
import { Icon } from '../lib/icons';
import { useApp } from '../stores/app';
import { useEditor } from '../stores/editor';
import { StepList } from './StepList';
import { TriggerChooser } from './TriggerChooser';

interface From {
  id: string;
  port: string;
}
interface GStep {
  node: FlowNode;
  def: NodeTypeInfo | undefined;
  number: number;
  /** Other steps that start from the same link (parallel paths). */
  also: FlowNode[];
  branches: { port: string; label: string; chain: GChain }[];
  tools: GChain[] | null;
}
interface GChain {
  from: From;
  steps: GStep[];
  /** Set when the chain returns to a step that is already shown. */
  loopTo: FlowNode | null;
}

interface Tree {
  roots: { trigger: GStep; chain: GChain }[];
  orphans: GStep[];
  numbers: Map<string, number>;
}

function buildTree(graph: Graph, types: TypeMap): Tree {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const visited = new Set<string>();
  const numbers = new Map<string, number>();
  let counter = 0;

  const targets = (from: From): FlowNode[] =>
    outgoing(graph, from.id, from.port)
      .map((e) => byId.get(e.target))
      .filter((n): n is FlowNode => !!n);

  const makeStep = (node: FlowNode, also: FlowNode[]): GStep => {
    visited.add(node.id);
    const def = types.get(node.type);
    const number = ++counter;
    numbers.set(node.id, number);
    const branches = branchPorts(def).map((p) => ({ port: p.id, label: p.label, chain: buildChain({ id: node.id, port: p.id }) }));
    const tools = def?.toolPort
      ? targets({ id: node.id, port: TOOLS_PORT })
          .filter((t) => !visited.has(t.id))
          .map((t) => buildChain({ id: node.id, port: TOOLS_PORT }, t))
      : null;
    return { node, def, number, also, branches, tools };
  };

  const buildChain = (from: From, first?: FlowNode): GChain => {
    const chain: GChain = { from, steps: [], loopTo: null };
    let cursor = from;
    let forced = first;
    for (;;) {
      const next = forced ? [forced] : targets(cursor);
      forced = undefined;
      if (next.length === 0) break;
      const node = next[0];
      if (visited.has(node.id)) {
        chain.loopTo = node;
        break;
      }
      const step = makeStep(node, next.slice(1));
      chain.steps.push(step);
      const main = mainPort(step.def);
      if (!main) break;
      cursor = { id: node.id, port: main };
    }
    return chain;
  };

  const roots: Tree['roots'] = [];
  for (const node of graph.nodes) {
    const def = types.get(node.type);
    if (!isTrigger(def) || visited.has(node.id)) continue;
    const trigger = makeStepShallow(node, def);
    const main = mainPort(def) ?? 'out';
    roots.push({ trigger, chain: buildChain({ id: node.id, port: main }) });
  }

  function makeStepShallow(node: FlowNode, def: NodeTypeInfo | undefined): GStep {
    visited.add(node.id);
    const number = ++counter;
    numbers.set(node.id, number);
    return { node, def, number, also: [], branches: [], tools: null };
  }

  const orphans: GStep[] = [];
  for (const node of graph.nodes) {
    if (visited.has(node.id)) continue;
    orphans.push(makeStep(node, []));
  }
  return { roots, orphans, numbers };
}

const notTrigger = (d: NodeTypeInfo) => !isTrigger(d);

function AddButton({ from, label, variant = 'between' }: { from: From; label?: string; variant?: 'between' | 'end' | 'empty' }) {
  return (
    <div className={`g-add g-add-${variant}`}>
      <Popover
        width={320}
        trigger={(open, toggle) =>
          variant === 'between' ? (
            <button type="button" className={`g-plus ${open ? 'active' : ''}`} onClick={toggle} title="Insert a step here" aria-label="Insert a step here">
              <Plus size={14} />
            </button>
          ) : (
            <button type="button" className={`g-add-btn ${open ? 'active' : ''}`} onClick={toggle}>
              <Plus size={14} /> {label ?? 'Add a step'}
            </button>
          )
        }
      >
        {(close) => (
          <div className="chooser">
            <StepList
              compact={false}
              autoFocus
              filter={notTrigger}
              onPick={(def) => {
                close();
                useEditor.getState().insertStep(def, from.id, from.port);
              }}
            />
          </div>
        )}
      </Popover>
    </div>
  );
}

function summarize(node: FlowNode, def: NodeTypeInfo | undefined): string {
  if (!def) return node.type;
  const parts: string[] = [];
  for (const f of def.fields) {
    if (parts.length >= 2) break;
    if (f.type === 'secret' || f.type === 'connection' || f.type === 'boolean' || f.group) continue;
    const v = node.config[f.key];
    if (v === undefined || v === null || v === '') continue;
    if (typeof v === 'object' && Object.keys(v as object).length === 0) continue;
    const opt = f.type === 'select' ? f.options?.find((o) => o.value === v)?.label : undefined;
    parts.push(`${f.label}: ${opt ?? preview(v, 60)}`);
  }
  return parts.join('  ·  ') || def.description;
}

function StepCard({ step, lead }: { step: GStep; lead: string }) {
  const { node, def } = step;
  const selected = useEditor((s) => s.selectedId === node.id);
  const status = useEditor((s) => s.run.status[node.id]);
  const error = useEditor((s) => s.run.errors[node.id]);
  const issueCount = useEditor((s) => s.issues.reduce((n, i) => (i.nodeId === node.id ? n + 1 : n), 0));
  const hasError = useEditor((s) => s.issues.some((i) => i.nodeId === node.id && i.severity === 'error'));

  return (
    <div
      className={`g-card ${selected ? 'selected' : ''} ${status ? `status-${status}` : ''} ${def ? `kind-${def.kind}` : 'missing'}`}
      role="button"
      tabIndex={0}
      onClick={() => useEditor.getState().select(node.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          useEditor.getState().select(node.id);
        }
      }}
    >
      <span className="g-num">{step.number}</span>
      <span className={`tile ${def ? `kind-${def.kind}` : ''}`}>{def ? <Icon name={def.icon} size={18} /> : <AlertTriangle size={18} />}</span>
      <div className="g-card-main">
        <div className="g-card-lead">{lead}</div>
        <strong>{def ? def.label : 'Plugin not installed'}</strong>
        <div className="g-card-sub">
          {def ? (
            summarize(node, def)
          ) : (
            <>
              This step needs a plugin that is not installed (<code>{node.type}</code>).{' '}
              <Link to="/marketplace" onClick={(e) => e.stopPropagation()}>
                Open Marketplace
              </Link>
            </>
          )}
        </div>
        {status === 'error' && error && <div className="g-card-error">{error}</div>}
      </div>
      <div className="g-card-side">
        {status === 'running' && <Loader2 size={16} className="spin status-icon running" />}
        {status === 'success' && <CheckCircle2 size={16} className="status-icon success" />}
        {status === 'error' && <XCircle size={16} className="status-icon error" />}
        {issueCount > 0 && (
          <span className={`issue-badge ${hasError ? 'error' : 'warning'}`} title={`${issueCount} problem${issueCount === 1 ? '' : 's'} — click to fix`}>
            {issueCount}
          </span>
        )}
        <code className="g-name">{node.name}</code>
        <button
          type="button"
          className="icon-btn g-delete"
          title="Delete step"
          aria-label="Delete step"
          onClick={(e) => {
            e.stopPropagation();
            useEditor.getState().remove([node.id], [], true);
          }}
        >
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  );
}

function StepBlock({ step, lead, numbers }: { step: GStep; lead: string; numbers: Map<string, number> }) {
  return (
    <>
      <StepCard step={step} lead={lead} />
      {step.also.length > 0 && (
        <div className="g-note">
          <Workflow size={13} /> Runs alongside {step.also.length} other path{step.also.length === 1 ? '' : 's'}:{' '}
          {step.also.map((n) => (
            <button key={n.id} type="button" className="link-btn" onClick={() => useEditor.getState().select(n.id)}>
              {n.name}
            </button>
          ))}
          <button type="button" className="link-btn" onClick={() => useEditor.getState().setMode('canvas')}>
            Open Canvas to edit parallel paths
          </button>
        </div>
      )}
      {step.branches.map((b) => (
        <div key={b.port} className={`g-branch g-branch-${b.port}`}>
          <div className="g-branch-label">
            <CornerDownRight size={14} /> {branchLabel(b.port, b.label)}
          </div>
          <ChainView chain={b.chain} numbers={numbers} emptyLabel={`Add a step for "${b.label}"`} />
        </div>
      ))}
      {step.tools && (
        <div className="g-branch g-branch-tools">
          <div className="g-branch-label">
            <Icon name="wrench" size={14} /> Tools this agent can use
          </div>
          {step.tools.length === 0 && <div className="g-note plain">No tools yet. Any step can be a tool — the agent decides when to use it.</div>}
          {step.tools.map((chain) => (
            <div key={chain.steps[0]?.node.id ?? 'empty'} className="g-tool">
              <ChainView chain={chain} numbers={numbers} skipLeadingAdd noEnd leadFirst="Tool" />
            </div>
          ))}
          <AddButton from={{ id: step.node.id, port: TOOLS_PORT }} label="Add a tool" variant="empty" />
        </div>
      )}
    </>
  );
}

function branchLabel(port: string, label: string): string {
  if (port === 'true') return 'If true';
  if (port === 'false') return 'If false';
  if (port === 'item') return 'For each item';
  return label;
}

function ChainView({
  chain,
  numbers,
  emptyLabel,
  skipLeadingAdd = false,
  leadFirst,
  noEnd = false,
}: {
  chain: GChain;
  numbers: Map<string, number>;
  emptyLabel?: string;
  skipLeadingAdd?: boolean;
  leadFirst?: string;
  noEnd?: boolean;
}) {
  if (chain.steps.length === 0 && !chain.loopTo) {
    return <AddButton from={chain.from} label={emptyLabel ?? 'Add a step'} variant="empty" />;
  }
  let from = chain.from;
  const out = chain.steps.map((step, i) => {
    const before = from;
    const main = mainPort(step.def);
    if (main) from = { id: step.node.id, port: main };
    return (
      <Fragment key={step.node.id}>
        {!(skipLeadingAdd && i === 0) && <AddButton from={before} />}
        <StepBlock step={step} lead={i === 0 && leadFirst ? leadFirst : 'Then'} numbers={numbers} />
      </Fragment>
    );
  });
  const last = chain.steps[chain.steps.length - 1];
  const canContinue = !last || mainPort(last.def) !== null;
  return (
    <>
      {out}
      {chain.loopTo ? (
        <div className="g-note">
          <CornerDownRight size={13} /> Continues at step {numbers.get(chain.loopTo.id) ?? '?'}{' '}
          <button type="button" className="link-btn" onClick={() => useEditor.getState().select(chain.loopTo!.id)}>
            {chain.loopTo.name}
          </button>
        </div>
      ) : (
        canContinue && !noEnd && <AddButton from={from} label="Add a step" variant="end" />
      )}
    </>
  );
}

export function Guided() {
  const graph = useEditor((s) => s.graph);
  const types = useApp((s) => s.nodeTypes);
  const tree = useMemo(() => buildTree(graph, types), [graph, types]);

  return (
    <div className="guided" onClick={(e) => e.target === e.currentTarget && useEditor.getState().select(null)}>
      <div className="guided-inner">
        {tree.roots.length === 0 && (
          <div className="card card-pad">
            <TriggerChooser />
          </div>
        )}
        {tree.roots.map(({ trigger, chain }) => (
          <section key={trigger.node.id} className="g-flow">
            <StepCard step={trigger} lead="When" />
            <ChainView chain={chain} numbers={tree.numbers} emptyLabel="Add the first step" />
          </section>
        ))}
        {tree.orphans.length > 0 && (
          <section className="g-flow g-orphans">
            <h3>Not connected yet</h3>
            <p className="muted small">
              These steps are not linked to the flow, so they will not run. Link them in{' '}
              <button type="button" className="link-btn" onClick={() => useEditor.getState().setMode('canvas')}>
                Canvas mode
              </button>{' '}
              or delete them.
            </p>
            {tree.orphans.map((step) => (
              <div key={step.node.id} className="g-orphan">
                <StepBlock step={step} lead="Step" numbers={tree.numbers} />
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
