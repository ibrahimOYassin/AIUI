import type { FlowEdge, FlowNode, Graph, NodeTypeInfo } from '@aiui/shared';
import { RESERVED_NAMES, uniqueName } from '@aiui/shared';

export type TypeMap = Map<string, NodeTypeInfo>;

export const TOOLS_PORT = 'tools';
export const COL_W = 300;
export const ROW_H = 150;

export function newId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 10)
      : Math.random().toString(36).slice(2, 12);
  return `${prefix}_${rand}`;
}

export function defaultConfig(def: NodeTypeInfo): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const field of def.fields) {
    if (field.default !== undefined) config[field.key] = structuredClone(field.default);
  }
  return config;
}

/** The port the flow continues on after this step, if there is one. */
export function mainPort(def: NodeTypeInfo | undefined): string | null {
  if (!def) return 'out';
  const ids = def.outputs.map((o) => o.id);
  if (ids.length === 0) return null;
  if (ids.length === 1) return ids[0];
  if (ids.includes('done')) return 'done';
  if (ids.includes('out')) return 'out';
  return null;
}

/** Ports that open a nested branch (true/false, item…). */
export function branchPorts(def: NodeTypeInfo | undefined): { id: string; label: string }[] {
  if (!def) return [];
  const main = mainPort(def);
  return def.outputs.filter((o) => o.id !== main);
}

export function isTrigger(def: NodeTypeInfo | undefined): boolean {
  return !!def && (def.kind === 'trigger' || def.inputs.length === 0);
}

export function makeNode(def: NodeTypeInfo, graph: Graph, position: { x: number; y: number }): FlowNode {
  const taken = [...graph.nodes.map((n) => n.name), ...RESERVED_NAMES];
  return {
    id: newId('n'),
    type: def.type,
    name: uniqueName(def.label, taken),
    position,
    config: defaultConfig(def),
    onError: 'stop',
  };
}

export function makeEdge(source: string, sourcePort: string, target: string): FlowEdge {
  return { id: newId('e'), source, sourcePort, target };
}

export function outgoing(graph: Graph, nodeId: string, port?: string): FlowEdge[] {
  return graph.edges.filter((e) => e.source === nodeId && (port === undefined || e.sourcePort === port));
}

export function incoming(graph: Graph, nodeId: string): FlowEdge[] {
  return graph.edges.filter((e) => e.target === nodeId);
}

/** Every step that can run before the given step (following links backwards). */
export function upstream(graph: Graph, nodeId: string): { ids: Set<string>; inLoop: boolean; isTool: boolean } {
  const ids = new Set<string>();
  let inLoop = false;
  let isTool = false;
  const queue = [nodeId];
  const seen = new Set<string>([nodeId]);
  while (queue.length) {
    const current = queue.shift()!;
    for (const edge of graph.edges) {
      if (edge.target !== current) continue;
      if (edge.sourcePort === 'item') inLoop = true;
      if (edge.sourcePort === TOOLS_PORT) isTool = true;
      if (!seen.has(edge.source)) {
        seen.add(edge.source);
        ids.add(edge.source);
        queue.push(edge.source);
      }
    }
  }
  return { ids, inLoop, isTool };
}

export function isLinkedAsTool(graph: Graph, nodeId: string): boolean {
  return graph.edges.some((e) => e.target === nodeId && e.sourcePort === TOOLS_PORT);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Rewrite {{old…}} references to {{new…}} anywhere inside a config value. */
export function renameRefs<T>(value: T, oldName: string, newName: string): T {
  const re = new RegExp(`(\\{\\{\\s*)${escapeRegExp(oldName)}(?=[\\s.}\\[])`, 'g');
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return v.replace(re, `$1${newName}`);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, inner] of Object.entries(v)) out[k] = walk(inner);
      return out;
    }
    return v;
  };
  return walk(value) as T;
}

export function renameNode(graph: Graph, nodeId: string, newName: string): Graph {
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node || node.name === newName) return graph;
  const oldName = node.name;
  return {
    ...graph,
    nodes: graph.nodes.map((n) =>
      n.id === nodeId ? { ...n, name: newName } : { ...n, config: renameRefs(n.config, oldName, newName) },
    ),
  };
}

/** Where to drop a step added from the library without a target position. */
export function freePosition(graph: Graph): { x: number; y: number } {
  if (graph.nodes.length === 0) return { x: 80, y: 120 };
  const right = graph.nodes.reduce((a, b) => (b.position.x > a.position.x ? b : a));
  return { x: right.position.x + COL_W, y: right.position.y };
}

function nudge(graph: Graph, position: { x: number; y: number }): { x: number; y: number } {
  const p = { ...position };
  let guard = 0;
  while (
    guard++ < 40 &&
    graph.nodes.some((n) => Math.abs(n.position.x - p.x) < 180 && Math.abs(n.position.y - p.y) < 90)
  ) {
    p.y += ROW_H;
  }
  return p;
}

/** Position for a new step attached to `source` on `port`. */
export function positionAfter(
  graph: Graph,
  source: FlowNode,
  port: string,
  def: NodeTypeInfo | undefined,
): { x: number; y: number } {
  if (port === TOOLS_PORT) {
    const count = outgoing(graph, source.id, TOOLS_PORT).length;
    return nudge(graph, { x: source.position.x + count * 240, y: source.position.y + 200 });
  }
  const ports = def?.outputs.map((o) => o.id) ?? ['out'];
  const idx = Math.max(0, ports.indexOf(port));
  const main = mainPort(def);
  const dy = port === main ? 0 : (idx + 1) * ROW_H * (ports.length > 2 && idx === 0 ? -1 : 1);
  return nudge(graph, { x: source.position.x + COL_W, y: source.position.y + (port === main ? 0 : dy) });
}

/**
 * Insert a new step right after `sourceId` on `port`. Steps that used to follow
 * are re-attached behind the new step, so the chain stays intact.
 */
export function insertAfter(
  graph: Graph,
  sourceId: string,
  port: string,
  def: NodeTypeInfo,
  types: TypeMap,
): { graph: Graph; node: FlowNode } {
  const source = graph.nodes.find((n) => n.id === sourceId);
  if (!source) {
    const node = makeNode(def, graph, freePosition(graph));
    return { graph: { ...graph, nodes: [...graph.nodes, node] }, node };
  }
  const node = makeNode(def, graph, positionAfter(graph, source, port, types.get(source.type)));
  if (port === TOOLS_PORT) {
    return {
      graph: { nodes: [...graph.nodes, node], edges: [...graph.edges, makeEdge(sourceId, port, node.id)] },
      node,
    };
  }
  const following = outgoing(graph, sourceId, port);
  const continueOn = mainPort(def) ?? def.outputs[0]?.id ?? null;
  const kept = graph.edges.filter((e) => !following.includes(e));
  const edges = [...kept, makeEdge(sourceId, port, node.id)];
  let nodes = [...graph.nodes, node];
  if (continueOn && following.length) {
    for (const edge of following) edges.push(makeEdge(node.id, continueOn, edge.target));
    // push the rest of the chain one column to the right to make room
    const moved = new Set<string>();
    const queue = following.map((e) => e.target);
    while (queue.length) {
      const id = queue.shift()!;
      if (moved.has(id) || id === node.id) continue;
      moved.add(id);
      for (const e of graph.edges) if (e.source === id && e.sourcePort !== TOOLS_PORT) queue.push(e.target);
    }
    nodes = nodes.map((n) =>
      moved.has(n.id) && n.position.x >= node.position.x - 10
        ? { ...n, position: { x: n.position.x + COL_W, y: n.position.y } }
        : n,
    );
    node.position = { x: source.position.x + COL_W, y: following.length ? positionOf(graph, following[0].target, node).y : node.position.y };
  }
  return { graph: { nodes, edges }, node };
}

function positionOf(graph: Graph, id: string, fallback: FlowNode): { x: number; y: number } {
  return graph.nodes.find((n) => n.id === id)?.position ?? fallback.position;
}

/** Remove steps. With `heal`, a removed step in the middle of a chain is bridged. */
export function removeNodes(graph: Graph, ids: string[], types: TypeMap, heal: boolean): Graph {
  let edges = graph.edges;
  const remove = new Set(ids);
  if (heal) {
    for (const id of ids) {
      const node = graph.nodes.find((n) => n.id === id);
      if (!node) continue;
      const ins = edges.filter((e) => e.target === id && !remove.has(e.source));
      const main = mainPort(types.get(node.type));
      const outs = main ? edges.filter((e) => e.source === id && e.sourcePort === main && !remove.has(e.target)) : [];
      if (ins.length === 1 && ins[0].sourcePort !== TOOLS_PORT) {
        for (const out of outs) edges = [...edges, makeEdge(ins[0].source, ins[0].sourcePort, out.target)];
      }
    }
  }
  return {
    nodes: graph.nodes.filter((n) => !remove.has(n.id)),
    edges: edges.filter((e) => !remove.has(e.source) && !remove.has(e.target)),
  };
}

/** Simple layered left-to-right layout. Tool steps sit below their agent. */
export function autoLayout(graph: Graph, types: TypeMap): Graph {
  const flowEdges = graph.edges.filter((e) => e.sourcePort !== TOOLS_PORT);
  const toolEdges = graph.edges.filter((e) => e.sourcePort === TOOLS_PORT);
  const hasFlowIn = new Set(flowEdges.map((e) => e.target));
  const toolOnly = new Set(toolEdges.map((e) => e.target).filter((id) => !hasFlowIn.has(id)));

  const depth = new Map<string, number>();
  const roots = graph.nodes.filter((n) => !hasFlowIn.has(n.id) && !toolOnly.has(n.id));
  roots.sort((a, b) => {
    const ta = isTrigger(types.get(a.type)) ? 0 : 1;
    const tb = isTrigger(types.get(b.type)) ? 0 : 1;
    return ta - tb || a.position.y - b.position.y;
  });
  const order: string[] = [];
  const visit = (id: string, d: number, trail: Set<string>) => {
    if (trail.has(id)) return;
    const prev = depth.get(id);
    if (prev !== undefined && prev >= d) return;
    if (prev === undefined) order.push(id);
    depth.set(id, d);
    trail.add(id);
    const outs = flowEdges.filter((e) => e.source === id);
    const ports = types.get(graph.nodes.find((n) => n.id === id)?.type ?? '')?.outputs.map((o) => o.id) ?? [];
    outs.sort((a, b) => ports.indexOf(a.sourcePort) - ports.indexOf(b.sourcePort));
    for (const e of outs) visit(e.target, d + 1, trail);
    trail.delete(id);
  };
  for (const r of roots) visit(r.id, 0, new Set());
  for (const n of graph.nodes) if (!depth.has(n.id) && !toolOnly.has(n.id)) visit(n.id, 0, new Set());

  const toolRows = new Map<string, number>();
  for (const e of toolEdges) toolRows.set(e.source, (toolRows.get(e.source) ?? 0) + 1);

  const layers = new Map<number, string[]>();
  for (const id of order) {
    const d = depth.get(id) ?? 0;
    layers.set(d, [...(layers.get(d) ?? []), id]);
  }
  const pos = new Map<string, { x: number; y: number }>();
  for (const [d, ids] of layers) {
    let y = 80;
    for (const id of ids) {
      pos.set(id, { x: 80 + d * COL_W, y });
      y += ROW_H + (toolRows.has(id) ? 190 : 0);
    }
  }
  const placedTools = new Map<string, number>();
  const placeTools = (agentId: string) => {
    const base = pos.get(agentId);
    if (!base) return;
    for (const e of toolEdges.filter((t) => t.source === agentId)) {
      if (pos.has(e.target) || !toolOnly.has(e.target)) continue;
      const i = placedTools.get(agentId) ?? 0;
      placedTools.set(agentId, i + 1);
      pos.set(e.target, { x: base.x + i * 250, y: base.y + 190 });
      placeTools(e.target);
    }
  };
  for (const id of order) placeTools(id);
  let orphanY = 80;
  return {
    ...graph,
    nodes: graph.nodes.map((n) => {
      const p = pos.get(n.id);
      if (p) return { ...n, position: p };
      const fallback = { x: 80 + (layers.size + 1) * COL_W, y: orphanY };
      orphanY += ROW_H;
      return { ...n, position: fallback };
    }),
  };
}

export function findTrigger(graph: Graph, types: TypeMap): FlowNode | undefined {
  return graph.nodes.find((n) => isTrigger(types.get(n.type)));
}

export function isValidName(name: string): boolean {
  return /^[a-z][a-z0-9_]*$/.test(name) && !RESERVED_NAMES.includes(name);
}
