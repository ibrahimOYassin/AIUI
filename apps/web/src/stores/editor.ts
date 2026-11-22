import { create } from 'zustand';
import type { ChatTurn, FlowNode, Graph, Issue, NodeTypeInfo, Project, RunEvent } from '@aiui/shared';
import { api, errorMessage, streamRun } from '../api';
import {
  TOOLS_PORT,
  autoLayout,
  freePosition,
  insertAfter,
  isTrigger,
  mainPort,
  makeEdge,
  makeNode,
  outgoing,
  positionAfter,
  removeNodes,
  renameNode,
} from '../lib/graph';
import { toast, useApp } from './app';

export type IdeMode = 'guided' | 'canvas' | 'code';
export type NodeStatus = 'running' | 'success' | 'error';
export type SaveState = 'saved' | 'dirty' | 'saving' | 'error';
export type BottomTab = 'log' | 'chat' | 'problems';
type RunEnd = Extract<RunEvent, { type: 'run_end' }>;

export interface RunState {
  running: boolean;
  events: RunEvent[];
  status: Record<string, NodeStatus>;
  outputs: Record<string, unknown>;
  errors: Record<string, string>;
  end: RunEnd | null;
}

const emptyRun: RunState = { running: false, events: [], status: {}, outputs: {}, errors: {}, end: null };
const emptyGraph: Graph = { nodes: [], edges: [] };

function initialMode(): IdeMode {
  try {
    const m = localStorage.getItem('aiui.mode');
    if (m === 'guided' || m === 'canvas' || m === 'code') return m;
  } catch {
    /* ignore */
  }
  return 'guided';
}

interface EditorState {
  project: Project | null;
  loading: boolean;
  loadError: string | null;
  graph: Graph;
  /** Bumped on every save; lets views know the saved copy changed. */
  savedVersion: number;
  selectedId: string | null;
  focusField: string | null;
  past: Graph[];
  future: Graph[];
  saveState: SaveState;
  issues: Issue[];
  mode: IdeMode;
  run: RunState;
  chat: ChatTurn[];
  bottomTab: BottomTab;
  bottomOpen: boolean;

  load: (id: string) => Promise<void>;
  unload: () => void;
  setMode: (mode: IdeMode) => void;
  select: (id: string | null, field?: string | null) => void;
  setBottom: (tab: BottomTab, open?: boolean) => void;
  toggleBottom: () => void;

  commit: (graph: Graph, coalesceKey?: string) => void;
  /** Change positions without creating an undo step per pixel. */
  moveNodes: (positions: Record<string, { x: number; y: number }>) => void;
  addStep: (def: NodeTypeInfo, position?: { x: number; y: number }) => FlowNode;
  insertStep: (def: NodeTypeInfo, sourceId: string, port: string) => FlowNode;
  updateNode: (id: string, patch: Partial<FlowNode>, coalesceKey?: string) => void;
  updateConfig: (id: string, key: string, value: unknown) => void;
  rename: (id: string, name: string) => void;
  remove: (nodeIds: string[], edgeIds?: string[], heal?: boolean) => void;
  connect: (source: string, sourcePort: string, target: string) => boolean;
  layout: () => void;
  undo: () => void;
  redo: () => void;

  renameProject: (name: string) => void;
  flushSave: () => Promise<boolean>;
  refreshIssues: () => Promise<void>;

  runProject: (input: unknown) => Promise<RunEnd | null>;
  stopRun: () => void;
  sendChat: (message: string) => Promise<void>;
  clearChat: () => void;
}

let saveTimer: number | undefined;
let saveQueue: Promise<void> = Promise.resolve();
let lastKey: string | null = null;
let lastAt = 0;
let runAbort: AbortController | null = null;
let loadSeq = 0;

export const useEditor = create<EditorState>((set, get) => {
  const types = () => useApp.getState().nodeTypes;

  const scheduleSave = () => {
    set({ saveState: 'dirty' });
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void get().flushSave(), 700);
  };

  const doSave = async () => {
    const { project, graph, saveState } = get();
    if (!project || (saveState !== 'dirty' && saveState !== 'error')) return;
    set({ saveState: 'saving' });
    try {
      await api.updateProject(project.id, { name: project.name, description: project.description, graph });
      const now = get();
      if (now.project?.id !== project.id) return;
      const stillCurrent = now.graph === graph && now.project.name === project.name;
      set({ saveState: stillCurrent ? 'saved' : 'dirty', savedVersion: now.savedVersion + 1 });
      if (!stillCurrent) scheduleSave();
      void get().refreshIssues();
    } catch (err) {
      if (get().project?.id === project.id) {
        set({ saveState: 'error' });
        toast('error', `Could not save: ${errorMessage(err)}`);
      }
    }
  };

  return {
    project: null,
    loading: false,
    loadError: null,
    graph: emptyGraph,
    savedVersion: 0,
    selectedId: null,
    focusField: null,
    past: [],
    future: [],
    saveState: 'saved',
    issues: [],
    mode: initialMode(),
    run: emptyRun,
    chat: [],
    bottomTab: 'log',
    bottomOpen: false,

    load: async (id) => {
      const seq = ++loadSeq;
      runAbort?.abort();
      window.clearTimeout(saveTimer);
      set({
        project: null,
        loading: true,
        loadError: null,
        graph: emptyGraph,
        selectedId: null,
        past: [],
        future: [],
        saveState: 'saved',
        issues: [],
        run: emptyRun,
        chat: [],
        bottomOpen: false,
      });
      try {
        const project = await api.project(id);
        if (seq !== loadSeq) return;
        const graph: Graph = { nodes: project.graph?.nodes ?? [], edges: project.graph?.edges ?? [] };
        const hasChat = graph.nodes.some((n) => n.type === 'trigger.chat');
        set({ project, graph, loading: false, bottomTab: hasChat ? 'chat' : 'log', bottomOpen: hasChat });
        void get().refreshIssues();
      } catch (err) {
        if (seq === loadSeq) set({ loading: false, loadError: errorMessage(err) });
      }
    },

    unload: () => {
      void get().flushSave();
      runAbort?.abort();
      loadSeq++;
      set({ project: null, graph: emptyGraph, selectedId: null, run: emptyRun, chat: [], issues: [] });
    },

    setMode: (mode) => {
      try {
        localStorage.setItem('aiui.mode', mode);
      } catch {
        /* ignore */
      }
      set({ mode });
    },

    select: (id, field = null) => set({ selectedId: id, focusField: field }),

    setBottom: (tab, open = true) => set({ bottomTab: tab, bottomOpen: open }),
    toggleBottom: () => set((s) => ({ bottomOpen: !s.bottomOpen })),

    commit: (graph, coalesceKey) => {
      const s = get();
      if (graph === s.graph) return;
      const now = Date.now();
      const coalesce = !!coalesceKey && coalesceKey === lastKey && now - lastAt < 1500;
      lastKey = coalesceKey ?? null;
      lastAt = now;
      set({ graph, past: coalesce ? s.past : [...s.past.slice(-99), s.graph], future: [] });
      scheduleSave();
    },

    moveNodes: (positions) => {
      const s = get();
      let changed = false;
      const nodes = s.graph.nodes.map((n) => {
        const p = positions[n.id];
        if (!p || (p.x === n.position.x && p.y === n.position.y)) return n;
        changed = true;
        return { ...n, position: { x: Math.round(p.x), y: Math.round(p.y) } };
      });
      if (changed) get().commit({ ...s.graph, nodes });
    },

    addStep: (def, position) => {
      const s = get();
      const selected = s.graph.nodes.find((n) => n.id === s.selectedId);
      // Clicking a library item with a step selected continues the flow from that step.
      if (!position && selected && !isTrigger(def)) {
        const selDef = types().get(selected.type);
        const port = mainPort(selDef);
        if (port && outgoing(s.graph, selected.id, port).length === 0) {
          const node = makeNode(def, s.graph, positionAfter(s.graph, selected, port, selDef));
          get().commit({
            nodes: [...s.graph.nodes, node],
            edges: [...s.graph.edges, makeEdge(selected.id, port, node.id)],
          });
          set({ selectedId: node.id, focusField: null });
          return node;
        }
      }
      const node = makeNode(def, s.graph, position ?? freePosition(s.graph));
      get().commit({ ...s.graph, nodes: [...s.graph.nodes, node] });
      set({ selectedId: node.id, focusField: null });
      return node;
    },

    insertStep: (def, sourceId, port) => {
      const result = insertAfter(get().graph, sourceId, port, def, types());
      get().commit(result.graph);
      set({ selectedId: result.node.id, focusField: null });
      return result.node;
    },

    updateNode: (id, patch, coalesceKey) => {
      const s = get();
      get().commit(
        { ...s.graph, nodes: s.graph.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) },
        coalesceKey,
      );
    },

    updateConfig: (id, key, value) => {
      const s = get();
      get().commit(
        {
          ...s.graph,
          nodes: s.graph.nodes.map((n) => {
            if (n.id !== id) return n;
            const config = { ...n.config };
            if (value === undefined) delete config[key];
            else config[key] = value;
            return { ...n, config };
          }),
        },
        `cfg:${id}:${key}`,
      );
    },

    rename: (id, name) => {
      get().commit(renameNode(get().graph, id, name));
    },

    remove: (nodeIds, edgeIds = [], heal = false) => {
      const s = get();
      let graph = nodeIds.length ? removeNodes(s.graph, nodeIds, types(), heal) : s.graph;
      if (edgeIds.length) graph = { ...graph, edges: graph.edges.filter((e) => !edgeIds.includes(e.id)) };
      if (graph === s.graph) return;
      get().commit(graph);
      if (s.selectedId && nodeIds.includes(s.selectedId)) set({ selectedId: null });
    },

    connect: (source, sourcePort, target) => {
      const s = get();
      if (source === target) return false;
      const targetNode = s.graph.nodes.find((n) => n.id === target);
      if (!targetNode) return false;
      const targetDef = types().get(targetNode.type);
      if (targetDef && targetDef.inputs.length === 0) {
        toast('info', 'A trigger starts the flow, so nothing can link into it.');
        return false;
      }
      if (s.graph.edges.some((e) => e.source === source && e.sourcePort === sourcePort && e.target === target)) {
        return false;
      }
      get().commit({ ...s.graph, edges: [...s.graph.edges, makeEdge(source, sourcePort, target)] });
      if (sourcePort === TOOLS_PORT && !targetNode.tool) {
        get().updateNode(target, { tool: { description: '', params: [] } });
      }
      return true;
    },

    layout: () => get().commit(autoLayout(get().graph, types())),

    undo: () => {
      const s = get();
      const prev = s.past[s.past.length - 1];
      if (!prev) return;
      lastKey = null;
      set({
        graph: prev,
        past: s.past.slice(0, -1),
        future: [s.graph, ...s.future].slice(0, 100),
        selectedId: prev.nodes.some((n) => n.id === s.selectedId) ? s.selectedId : null,
      });
      scheduleSave();
    },

    redo: () => {
      const s = get();
      const next = s.future[0];
      if (!next) return;
      lastKey = null;
      set({
        graph: next,
        past: [...s.past, s.graph],
        future: s.future.slice(1),
        selectedId: next.nodes.some((n) => n.id === s.selectedId) ? s.selectedId : null,
      });
      scheduleSave();
    },

    renameProject: (name) => {
      const project = get().project;
      if (!project || !name.trim() || name === project.name) return;
      set({ project: { ...project, name: name.trim() } });
      scheduleSave();
    },

    flushSave: async () => {
      window.clearTimeout(saveTimer);
      for (let attempt = 0; attempt < 3; attempt++) {
        saveQueue = saveQueue.then(doSave, doSave);
        await saveQueue;
        window.clearTimeout(saveTimer);
        if (get().saveState !== 'dirty') break;
      }
      return get().saveState === 'saved';
    },

    refreshIssues: async () => {
      const project = get().project;
      if (!project) return;
      try {
        const issues = await api.validate(project.id);
        if (get().project?.id === project.id) set({ issues });
      } catch {
        /* validation is advisory; a failure here must not interrupt editing */
      }
    },

    runProject: async (input) => {
      const project = get().project;
      if (!project || get().run.running) return null;
      const saved = await get().flushSave();
      if (!saved) {
        toast('error', 'Your latest changes could not be saved, so the run was not started.');
        return null;
      }
      runAbort = new AbortController();
      const signal = runAbort.signal;
      set({ run: { ...emptyRun, running: true } });
      let end: RunEnd | null = null;
      const push = (event: RunEvent) =>
        set((s) => {
          const run: RunState = { ...s.run, events: [...s.run.events, event] };
          if (event.type === 'node_start') {
            run.status = { ...run.status, [event.nodeId]: 'running' };
          } else if (event.type === 'node_end') {
            run.status = { ...run.status, [event.nodeId]: 'success' };
            run.outputs = { ...run.outputs, [event.nodeId]: event.output };
          } else if (event.type === 'node_error') {
            run.status = { ...run.status, [event.nodeId]: 'error' };
            run.errors = { ...run.errors, [event.nodeId]: event.error };
          } else if (event.type === 'run_end') {
            run.end = event;
          }
          return { run };
        });
      try {
        for await (const event of streamRun(project.id, { input }, signal)) {
          if (get().project?.id !== project.id) break;
          push(event);
          if (event.type === 'run_end') end = event;
        }
        if (!end) {
          end = { type: 'run_end', status: 'error', error: 'The run ended without a result.', ms: 0 };
          push(end);
        }
      } catch (err) {
        const aborted = signal.aborted;
        end = {
          type: 'run_end',
          status: aborted ? 'stopped' : 'error',
          error: aborted ? undefined : errorMessage(err),
          ms: 0,
        };
        if (get().project?.id === project.id) push(end);
      } finally {
        if (get().project?.id === project.id) {
          set((s) => {
            // anything still "running" when the stream closed did not finish
            const status = { ...s.run.status };
            for (const [id, st] of Object.entries(status)) if (st === 'running') delete status[id];
            return { run: { ...s.run, status, running: false } };
          });
        }
        runAbort = null;
      }
      return end;
    },

    stopRun: () => runAbort?.abort(),

    sendChat: async (message) => {
      const history = get().chat;
      set({ chat: [...history, { role: 'user', content: message }] });
      const end = await get().runProject({ message, history });
      let reply: string;
      if (!end) {
        reply = 'The message could not be sent.';
      } else if (end.status === 'stopped') {
        reply = '(stopped)';
      } else if (end.status === 'error') {
        reply = `Something went wrong: ${end.error ?? 'unknown error'}. Open the Run log for details.`;
      } else {
        reply = replyText(end.output);
      }
      set((s) => ({ chat: [...s.chat, { role: 'assistant', content: reply }] }));
    },

    clearChat: () => set({ chat: [] }),
  };
});

function replyText(output: unknown): string {
  if (typeof output === 'string') return output;
  if (output && typeof output === 'object') {
    const o = output as Record<string, unknown>;
    for (const key of ['text', 'reply', 'message', 'content', 'output']) {
      if (typeof o[key] === 'string') return o[key] as string;
    }
    return JSON.stringify(output, null, 2);
  }
  return output === undefined || output === null ? '(no reply)' : String(output);
}
