import { Link } from 'react-router-dom';
import { Icon } from '../lib/icons';
import { isTrigger } from '../lib/graph';
import { useApp } from '../stores/app';
import { useEditor } from '../stores/editor';

/** First thing a blank project shows: pick how the flow starts. */
export function TriggerChooser() {
  const nodeTypes = useApp((s) => s.catalog.nodeTypes);
  const triggers = nodeTypes.filter((d) => isTrigger(d));
  return (
    <div className="trigger-chooser">
      <h2>Choose how this starts</h2>
      <p className="muted">Every project begins with a trigger. You can change it later.</p>
      {triggers.length === 0 ? (
        <p className="muted">
          No trigger steps are installed. <Link to="/marketplace/installed">Check your plugins</Link>.
        </p>
      ) : (
        <div className="choice-list">
          {triggers.map((def) => (
            <button key={def.type} type="button" className="choice" onClick={() => useEditor.getState().addStep(def, { x: 80, y: 120 })}>
              <span className="tile kind-trigger">
                <Icon name={def.icon} size={18} />
              </span>
              <span>
                <strong>{def.label}</strong>
                <small>{def.description}</small>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
