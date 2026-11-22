import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Store } from 'lucide-react';
import type { NodeKind, NodeTypeInfo } from '@aiui/shared';
import { Icon } from '../lib/icons';
import { useApp } from '../stores/app';

export const DRAG_TYPE = 'application/x-aiui-step';
const KIND_ORDER: NodeKind[] = ['trigger', 'ai', 'action', 'logic'];

/** Searchable, grouped list of step types. Used by the library panel and the "+" choosers. */
export function StepList({
  onPick,
  filter,
  draggable = false,
  autoFocus = false,
  compact = false,
}: {
  onPick: (def: NodeTypeInfo) => void;
  filter?: (def: NodeTypeInfo) => boolean;
  draggable?: boolean;
  autoFocus?: boolean;
  compact?: boolean;
}) {
  const nodeTypes = useApp((s) => s.catalog.nodeTypes);
  const [q, setQ] = useState('');

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = nodeTypes.filter((d) => {
      if (filter && !filter(d)) return false;
      if (!needle) return true;
      return `${d.label} ${d.description} ${d.category} ${d.pluginName}`.toLowerCase().includes(needle);
    });
    const map = new Map<string, NodeTypeInfo[]>();
    for (const d of list) map.set(d.category, [...(map.get(d.category) ?? []), d]);
    const rank = (defs: NodeTypeInfo[]) => Math.min(...defs.map((d) => KIND_ORDER.indexOf(d.kind)).map((i) => (i < 0 ? 99 : i)));
    return [...map.entries()].sort((a, b) => rank(a[1]) - rank(b[1]) || a[0].localeCompare(b[0]));
  }, [nodeTypes, q, filter]);

  return (
    <div className={`step-list ${compact ? 'compact' : ''}`}>
      <div className="search">
        <Search size={14} />
        <input placeholder="Search steps…" value={q} autoFocus={autoFocus} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="step-list-scroll">
        {groups.length === 0 && (
          <div className="step-list-empty">
            <p>{q ? `No step matches "${q}".` : 'No steps available.'}</p>
            <Link to="/marketplace" className="link-btn">
              <Store size={13} /> Find more in the Marketplace
            </Link>
          </div>
        )}
        {groups.map(([category, defs]) => (
          <div key={category} className="step-group">
            <div className="step-group-label">{category}</div>
            {defs.map((def) => (
              <button
                key={def.type}
                type="button"
                className="step-item"
                title={draggable ? `${def.description}\n\nClick to add, or drag onto the canvas.` : def.description}
                draggable={draggable}
                onDragStart={(e) => {
                  e.dataTransfer.setData(DRAG_TYPE, def.type);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => onPick(def)}
              >
                <span className={`tile tile-sm kind-${def.kind}`}>
                  <Icon name={def.icon} size={15} />
                </span>
                <span className="step-item-text">
                  <strong>{def.label}</strong>
                  {!compact && <small>{def.description}</small>}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
