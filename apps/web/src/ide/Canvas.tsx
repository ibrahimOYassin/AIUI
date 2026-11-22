import { type DragEvent as ReactDragEvent, memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Background,
  BackgroundVariant,
  type Connection as RFConnection,
  Controls,
  type Edge,
  Handle,
  MarkerType,
  MiniMap,
  type Node,
  type NodeProps,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import { AlertTriangle, CheckCircle2, LayoutGrid, Loader2, Redo2, Undo2, XCircle } from 'lucide-react';
import type { NodeTypeInfo } from '@aiui/shared';
import { TOOLS_PORT, isLinkedAsTool, isTrigger } from '../lib/graph';
import { Icon } from '../lib/icons';
import { useApp } from '../stores/app';
import { useEditor } from '../stores/editor';
import { DRAG_TYPE } from './StepList';
import { TriggerChooser } from './TriggerChooser';

type StepRFNode = Node<Record<string, never>, 'step'>;

/** Target handle on top of a step; tool links from an agent arrive here. */
const TOOL_IN = 'tool-in';

const StepNodeView = memo(function StepNodeView({ id, selected }: NodeProps<StepRFNode>) {
  const node = useEditor((s) => s.graph.nodes.find((n) => n.id === id));
  const def = useApp((s) => (node ? s.nodeTypes.get(node.type) : undefined));
  const status = useEditor((s) => s.run.status[id]);
  const issueCount = useEditor((s) => s.issues.reduce((n, i) => (i.nodeId === id ? n + 1 : n), 0));
  const hasError = useEditor((s) => s.issues.some((i) => i.nodeId === id && i.severity === 'error'));
  const asTool = useEditor((s) => isLinkedAsTool(s.graph, id));
  if (!node) return null;

  if (!def) {
    return (
      <div className={`step-node missing ${selected ? 'selected' : ''}`}>
        <Handle type="target" id="in" position={Position.Left} />
        <div className="step-node-head">
          <span className="tile tile-sm">
            <AlertTriangle size={15} />
          </span>
          <div className="step-node-title">
            <strong>Plugin not installed</strong>
            <small>{node.type}</small>
          </div>
        </div>
        <Link to="/marketplace" className="step-node-link nodrag">
          Find it in the Marketplace
        </Link>
        <Handle type="source" id="out" position={Position.Right} />
      </div>
    );
  }

  const outputs = def.outputs;
  const multi = outputs.length > 1;
  return (
    <div className={`step-node kind-${def.kind} ${selected ? 'selected' : ''} ${status ? `status-${status}` : ''} ${asTool ? 'as-tool' : ''}`}>
      {def.inputs.length > 0 && <Handle type="target" id="in" position={Position.Left} />}
      {def.inputs.length > 0 && <Handle type="target" id={TOOL_IN} position={Position.Top} className="handle-tool-in" />}
      <div className="step-node-head">
        <span className={`tile tile-sm kind-${def.kind}`}>
          <Icon name={def.icon} size={15} />
        </span>
        <div className="step-node-title">
          <strong>{def.label}</strong>
          <small>{node.name}</small>
        </div>
        <span className="step-node-badges">
          {status === 'running' && <Loader2 size={14} className="spin status-icon running" />}
          {status === 'success' && <CheckCircle2 size={14} className="status-icon success" />}
          {status === 'error' && <XCircle size={14} className="status-icon error" />}
          {issueCount > 0 && (
            <span className={`issue-badge ${hasError ? 'error' : 'warning'}`} title={`${issueCount} problem${issueCount === 1 ? '' : 's'}`}>
              {issueCount}
            </span>
          )}
        </span>
      </div>
      {asTool && <div className="step-node-tag">Tool</div>}
      {multi && (
        <div className="step-node-ports">
          {outputs.map((o) => (
            <div key={o.id} className="step-node-port">
              <span>{o.label}</span>
              <Handle type="source" id={o.id} position={Position.Right} />
            </div>
          ))}
        </div>
      )}
      {!multi && outputs.length === 1 && <Handle type="source" id={outputs[0].id} position={Position.Right} />}
      {def.toolPort && (
        <>
          <div className="step-node-tools">Tools</div>
          <Handle type="source" id={TOOLS_PORT} position={Position.Bottom} className="handle-tools" />
        </>
      )}
    </div>
  );
});

const nodeTypesMap = { step: StepNodeView };

function CanvasInner() {
  const graph = useEditor((s) => s.graph);
  const selectedId = useEditor((s) => s.selectedId);
  const pastLen = useEditor((s) => s.past.length);
  const futureLen = useEditor((s) => s.future.length);
  const runStatus = useEditor((s) => s.run.status);
  const types = useApp((s) => s.nodeTypes);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<StepRFNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const fitted = useRef(false);

  // Store → React Flow. Existing node objects are reused so measured sizes survive.
  useEffect(() => {
    setNodes((prev) => {
      const byId = new Map(prev.map((n) => [n.id, n]));
      return graph.nodes.map((g) => {
        const old = byId.get(g.id);
        const selected = g.id === selectedId;
        if (old) {
          if (old.position.x === g.position.x && old.position.y === g.position.y && !!old.selected === selected) return old;
          return { ...old, position: g.position, selected };
        }
        return { id: g.id, type: 'step' as const, position: g.position, data: {}, selected };
      });
    });
  }, [graph.nodes, selectedId, setNodes]);

  useEffect(() => {
    setEdges((prev) => {
      const selected = new Set(prev.filter((e) => e.selected).map((e) => e.id));
      return graph.edges.map((e) => {
        const tools = e.sourcePort === TOOLS_PORT;
        const active = runStatus[e.source] === 'success' && !!runStatus[e.target];
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourcePort,
          targetHandle: tools ? TOOL_IN : 'in',
          selected: selected.has(e.id),
          className: `${tools ? 'edge-tools' : ''} ${active ? 'edge-active' : ''}`,
          animated: runStatus[e.target] === 'running',
          markerEnd: tools ? undefined : { type: MarkerType.ArrowClosed, width: 16, height: 16 },
        };
      });
    });
  }, [graph.edges, runStatus, setEdges]);

  useEffect(() => {
    if (fitted.current || nodes.length === 0) return;
    fitted.current = true;
    const t = window.setTimeout(() => void fitView({ padding: 0.25, maxZoom: 1, duration: 0 }), 60);
    return () => window.clearTimeout(t);
  }, [nodes.length, fitView]);

  const onConnect = useCallback((c: RFConnection) => {
    if (!c.source || !c.target) return;
    useEditor.getState().connect(c.source, c.sourceHandle ?? 'out', c.target);
  }, []);

  const isValidConnection = useCallback((c: RFConnection | Edge) => c.source !== c.target, []);

  const onDrop = useCallback(
    (e: ReactDragEvent) => {
      const type = e.dataTransfer.getData(DRAG_TYPE);
      const def: NodeTypeInfo | undefined = type ? useApp.getState().nodeTypes.get(type) : undefined;
      if (!def) return;
      e.preventDefault();
      const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      useEditor.getState().addStep(def, { x: Math.round(p.x - 100), y: Math.round(p.y - 28) });
    },
    [screenToFlowPosition],
  );

  const minimapColor = useCallback(
    (n: Node) => {
      const g = useEditor.getState().graph.nodes.find((x) => x.id === n.id);
      const kind = g ? types.get(g.type)?.kind : undefined;
      return kind ? `var(--kind-${kind})` : 'var(--text-3)';
    },
    [types],
  );

  const hasTrigger = useMemo(() => graph.nodes.some((n) => isTrigger(types.get(n.type))), [graph.nodes, types]);

  return (
    <div
      className="canvas"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DRAG_TYPE)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={onDrop}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypesMap}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onNodeClick={(_, n) => useEditor.getState().select(n.id)}
        onPaneClick={() => useEditor.getState().select(null)}
        onNodeDragStop={(_, _node, dragged) => {
          const positions: Record<string, { x: number; y: number }> = {};
          for (const n of dragged) positions[n.id] = n.position;
          useEditor.getState().moveNodes(positions);
        }}
        onDelete={({ nodes: ns, edges: es }) =>
          useEditor.getState().remove(
            ns.map((n) => n.id),
            es.map((e) => e.id),
          )
        }
        deleteKeyCode={['Backspace', 'Delete']}
        minZoom={0.2}
        maxZoom={1.75}
        snapToGrid
        snapGrid={[10, 10]}
        defaultEdgeOptions={{ type: 'default' }}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable nodeColor={minimapColor} nodeStrokeWidth={0} style={{ width: 150, height: 100 }} />
        <Panel position="top-left" className="canvas-tools">
          <button type="button" className="icon-btn" disabled={pastLen === 0} onClick={() => useEditor.getState().undo()} title="Undo (Ctrl+Z)">
            <Undo2 size={16} />
          </button>
          <button type="button" className="icon-btn" disabled={futureLen === 0} onClick={() => useEditor.getState().redo()} title="Redo (Ctrl+Shift+Z)">
            <Redo2 size={16} />
          </button>
          <span className="sep" />
          <button
            type="button"
            className="tool-btn"
            disabled={graph.nodes.length < 2}
            onClick={() => {
              useEditor.getState().layout();
              window.setTimeout(() => void fitView({ padding: 0.25, maxZoom: 1, duration: 300 }), 80);
            }}
            title="Arrange steps left to right"
          >
            <LayoutGrid size={15} /> Tidy up
          </button>
        </Panel>
        {graph.nodes.length > 0 && !hasTrigger && (
          <Panel position="top-center" className="canvas-hint">
            <AlertTriangle size={14} /> This project has no trigger yet. Add one from the step library so it knows how to start.
          </Panel>
        )}
      </ReactFlow>
      {graph.nodes.length === 0 && (
        <div className="canvas-empty">
          <TriggerChooser />
          <p className="muted small">You can also drag any step from the library on the left.</p>
        </div>
      )}
    </div>
  );
}

export function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
