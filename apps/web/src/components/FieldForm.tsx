import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Braces, ChevronDown, ChevronRight, Plus, Search, Trash2 } from 'lucide-react';
import type { FieldDef } from '@aiui/shared';
import { useApp } from '../stores/app';
import { Popover } from './ui';

export interface VarItem {
  ref: string;
  label: string;
  hint?: string;
}
export interface VarGroup {
  label: string;
  icon?: string;
  items: VarItem[];
}

type Editable = HTMLInputElement | HTMLTextAreaElement;

/** Insert text at the caret of a React-controlled input and let React see the change. */
function insertAtCursor(el: Editable, text: string) {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? start;
  const next = el.value.slice(0, start) + text + el.value.slice(end);
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, next);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.focus();
  const caret = start + text.length;
  try {
    el.setSelectionRange(caret, caret);
  } catch {
    /* some input types do not support selection */
  }
}

function VariablePicker({ groups, onPick }: { groups: VarGroup[]; onPick: (ref: string) => void }) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return groups;
    return groups
      .map((g) => ({
        ...g,
        items: g.items.filter((i) => i.label.toLowerCase().includes(needle) || i.ref.toLowerCase().includes(needle)),
      }))
      .filter((g) => g.items.length);
  }, [groups, q]);
  return (
    <div className="var-picker">
      <div className="var-search">
        <Search size={14} />
        <input autoFocus placeholder="Search data…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="var-list">
        {filtered.length === 0 && (
          <div className="var-empty">
            {groups.length === 0
              ? 'No earlier steps yet. Link this step after another one to use its data.'
              : 'Nothing matches.'}
          </div>
        )}
        {filtered.map((g) => (
          <div key={g.label} className="var-group">
            <div className="var-group-label">{g.label}</div>
            {g.items.map((item) => (
              <button key={item.ref} type="button" className="var-item" onClick={() => onPick(item.ref)}>
                <span>{item.label}</span>
                <code>{`{{${item.ref}}}`}</code>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function matchesShowIf(field: FieldDef, values: Record<string, unknown>, all: FieldDef[]): boolean {
  if (!field.showIf) return true;
  const other = all.find((f) => f.key === field.showIf!.field);
  const current = values[field.showIf.field] ?? other?.default;
  const expected = field.showIf.equals;
  return Array.isArray(expected) ? expected.includes(current) : current === expected;
}

function isEmpty(v: unknown): boolean {
  if (v === undefined || v === null || v === '') return true;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

interface FormProps {
  fields: FieldDef[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  /** When given, templated fields get the "Insert data" button. */
  variables?: VarGroup[];
  /** Secret keys that already hold a stored value (connections). */
  secretsSet?: string[];
  /** Field key → problem message. */
  problems?: Record<string, string>;
  /** Field to scroll to and focus. */
  focusField?: string | null;
  /** Changes when the edited object changes, to reset local editors. */
  resetKey?: string;
}

export function FieldsForm(props: FormProps) {
  const { fields, values } = props;
  const visible = fields.filter((f) => matchesShowIf(f, values, fields));
  const main = visible.filter((f) => !f.group);
  const groups = new Map<string, FieldDef[]>();
  for (const f of visible) if (f.group) groups.set(f.group, [...(groups.get(f.group) ?? []), f]);
  return (
    <div className="fields">
      {main.map((f) => (
        <FieldRow key={f.key} field={f} {...props} />
      ))}
      {[...groups].map(([name, list]) => (
        <FieldGroup
          key={name}
          name={name}
          forceOpen={list.some((f) => f.key === props.focusField || props.problems?.[f.key])}
        >
          {list.map((f) => (
            <FieldRow key={f.key} field={f} {...props} />
          ))}
        </FieldGroup>
      ))}
    </div>
  );
}

function FieldGroup({ name, forceOpen, children }: { name: string; forceOpen: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const shown = open || forceOpen;
  return (
    <div className="field-group">
      <button type="button" className="field-group-head" onClick={() => setOpen(!shown)}>
        {shown ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {name}
      </button>
      {shown && <div className="field-group-body">{children}</div>}
    </div>
  );
}

function FieldRow({ field, values, onChange, variables, secretsSet, problems, focusField, resetKey }: FormProps & { field: FieldDef }) {
  const wrap = useRef<HTMLDivElement>(null);
  const lastFocused = useRef<Editable | null>(null);
  const value = values[field.key];
  const problem = problems?.[field.key];
  const canInsert = !!variables && !!field.templated;

  useEffect(() => {
    if (focusField !== field.key || !wrap.current) return;
    wrap.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const el = wrap.current.querySelector<HTMLElement>('input, textarea, select');
    el?.focus();
  }, [focusField, field.key]);

  const insert = (ref: string) => {
    const el =
      lastFocused.current && wrap.current?.contains(lastFocused.current)
        ? lastFocused.current
        : wrap.current?.querySelector<Editable>('input[type="text"], textarea');
    if (el) insertAtCursor(el, `{{${ref}}}`);
    else onChange(field.key, `${typeof value === 'string' ? value : ''}{{${ref}}}`);
  };

  const set = (v: unknown) => onChange(field.key, v);
  const inline = field.type === 'boolean';

  return (
    <div
      ref={wrap}
      className={`field ${inline ? 'field-inline' : ''} ${problem ? 'field-problem' : ''}`}
      onFocusCapture={(e) => {
        const t = e.target as HTMLElement;
        if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) lastFocused.current = t;
      }}
    >
      <div className="field-label">
        <label>
          {field.label}
          {field.required && <span className="req" title="Required">*</span>}
        </label>
        {canInsert && (
          <Popover
            align="right"
            width={300}
            trigger={(open, toggle) => (
              <button
                type="button"
                className={`insert-btn ${open ? 'active' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={toggle}
                title="Use data from an earlier step"
              >
                <Braces size={12} /> Insert data
              </button>
            )}
          >
            {(close) => (
              <VariablePicker
                groups={variables ?? []}
                onPick={(ref) => {
                  insert(ref);
                  close();
                }}
              />
            )}
          </Popover>
        )}
        {inline && <Toggle checked={value === undefined ? !!field.default : !!value} onChange={set} />}
      </div>
      {!inline && (
        <FieldControl field={field} value={value} onChange={set} secretSet={!!secretsSet?.includes(field.key)} resetKey={resetKey} />
      )}
      {problem && <div className="field-error">{problem}</div>}
      {field.help && <div className="field-help">{field.help}</div>}
    </div>
  );
}

export function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={`toggle ${checked ? 'on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

function FieldControl({
  field,
  value,
  onChange,
  secretSet,
  resetKey,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
  secretSet: boolean;
  resetKey?: string;
}) {
  const text = value === undefined || value === null ? '' : typeof value === 'string' ? value : String(value);
  switch (field.type) {
    case 'textarea':
      return (
        <textarea
          rows={field.rows ?? 4}
          value={typeof value === 'string' || value == null ? text : JSON.stringify(value)}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
        />
      );
    case 'number':
      if (field.templated) {
        return (
          <input
            type="text"
            inputMode="decimal"
            value={text}
            placeholder={field.placeholder}
            onChange={(e) => {
              const raw = e.target.value;
              const trimmed = raw.trim();
              onChange(trimmed !== '' && !Number.isNaN(Number(trimmed)) ? Number(trimmed) : raw === '' ? undefined : raw);
            }}
          />
        );
      }
      return (
        <input
          type="number"
          value={text}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      );
    case 'select':
      return (
        <select value={text} onChange={(e) => onChange(e.target.value)}>
          {!field.required && <option value="">—</option>}
          {field.required && text === '' && <option value="">Choose…</option>}
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case 'secret':
      return (
        <input
          type="password"
          autoComplete="new-password"
          value={text}
          placeholder={secretSet ? 'Saved — leave blank to keep' : (field.placeholder ?? '')}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'connection':
      return <ConnectionField field={field} value={value} onChange={onChange} />;
    case 'json':
      return <JsonField field={field} value={value} onChange={onChange} resetKey={resetKey} />;
    case 'keyvalue':
      return <KeyValueField field={field} value={value} onChange={onChange} resetKey={resetKey} />;
    case 'list':
      return <ListField field={field} value={value} onChange={onChange} />;
    case 'boolean':
      return null;
    case 'text':
    default:
      return <input type="text" value={text} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} spellCheck={false} />;
  }
}

function ConnectionField({ field, value, onChange }: { field: FieldDef; value: unknown; onChange: (v: unknown) => void }) {
  const connections = useApp((s) => s.connections);
  const connTypes = useApp((s) => s.catalog.connectionTypes);
  const openDialog = useApp((s) => s.openConnectionDialog);
  const options = connections.filter((c) => !field.connectionType || c.type === field.connectionType);
  const typeLabel = connTypes.find((t) => t.type === field.connectionType)?.label ?? 'connection';

  const create = async () => {
    const saved = await openDialog({ type: field.connectionType, lockType: !!field.connectionType });
    if (!saved) return;
    if (field.multiple) {
      const current = Array.isArray(value) ? (value as string[]) : [];
      onChange([...current, saved.id]);
    } else onChange(saved.id);
  };

  if (field.multiple) {
    const selected = Array.isArray(value) ? (value as string[]) : typeof value === 'string' && value ? [value] : [];
    return (
      <div className="checklist">
        {options.length === 0 && <div className="field-help">No {typeLabel} yet.</div>}
        {options.map((c) => (
          <label key={c.id} className="check">
            <input
              type="checkbox"
              checked={selected.includes(c.id)}
              onChange={(e) =>
                onChange(e.target.checked ? [...selected, c.id] : selected.filter((id) => id !== c.id))
              }
            />
            {c.name}
          </label>
        ))}
        <button type="button" className="link-btn" onClick={() => void create()}>
          <Plus size={13} /> New {typeLabel}…
        </button>
      </div>
    );
  }

  const current = typeof value === 'string' ? value : '';
  const missing = current !== '' && !options.some((c) => c.id === current);
  return (
    <div className="conn-field">
      <select
        value={current}
        onChange={(e) => {
          if (e.target.value === '__new__') void create();
          else onChange(e.target.value || undefined);
        }}
      >
        <option value="">{options.length ? `Choose a ${typeLabel}…` : `No ${typeLabel} yet`}</option>
        {missing && <option value={current}>(deleted connection)</option>}
        {options.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
        <option value="__new__">+ New {typeLabel}…</option>
      </select>
      {options.length === 0 && (
        <button type="button" className="btn btn-default btn-sm" onClick={() => void create()}>
          <Plus size={14} />
          <span>New</span>
        </button>
      )}
    </div>
  );
}

function JsonField({ field, value, onChange, resetKey }: { field: FieldDef; value: unknown; onChange: (v: unknown) => void; resetKey?: string }) {
  const toText = (v: unknown) => (v === undefined || v === null ? '' : typeof v === 'string' ? v : JSON.stringify(v, null, 2));
  const [text, setText] = useState(() => toText(value));
  const [error, setError] = useState<string | null>(null);
  const emitted = useRef<unknown>(value);

  useEffect(() => {
    if (value !== emitted.current) {
      emitted.current = value;
      setText(toText(value));
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, resetKey]);

  const change = (next: string) => {
    setText(next);
    const trimmed = next.trim();
    if (trimmed === '') {
      setError(null);
      emitted.current = undefined;
      onChange(undefined);
      return;
    }
    try {
      const parsed: unknown = JSON.parse(trimmed);
      setError(null);
      emitted.current = parsed;
      onChange(parsed);
    } catch (err) {
      if (field.templated && trimmed.includes('{{')) {
        // References are filled in at run time, so the text is kept as written.
        setError(null);
        emitted.current = next;
        onChange(next);
      } else {
        setError(err instanceof Error ? err.message : 'Not valid JSON');
      }
    }
  };

  return (
    <>
      <textarea
        className="mono"
        rows={field.rows ?? 5}
        value={text}
        placeholder={field.placeholder ?? '{ }'}
        onChange={(e) => change(e.target.value)}
        spellCheck={false}
      />
      {error && <div className="field-error">Not valid JSON yet: {error}</div>}
    </>
  );
}

interface Row {
  id: number;
  key: string;
  value: string;
}
let rowSeq = 1;

function toRows(value: unknown): Row[] {
  if (Array.isArray(value)) {
    return value.map((r) => {
      const o = (r ?? {}) as Record<string, unknown>;
      return { id: rowSeq++, key: String(o.key ?? o.name ?? ''), value: stringify(o.value) };
    });
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).map(([k, v]) => ({ id: rowSeq++, key: k, value: stringify(v) }));
  }
  return [];
}

function stringify(v: unknown): string {
  if (v === undefined || v === null) return '';
  return typeof v === 'string' ? v : JSON.stringify(v);
}

function KeyValueField({ field, value, onChange, resetKey }: { field: FieldDef; value: unknown; onChange: (v: unknown) => void; resetKey?: string }) {
  const [rows, setRows] = useState<Row[]>(() => toRows(value));
  const emitted = useRef<unknown>(value);

  useEffect(() => {
    if (value !== emitted.current) {
      emitted.current = value;
      setRows(toRows(value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, resetKey]);

  const update = (next: Row[]) => {
    setRows(next);
    const obj: Record<string, string> = {};
    for (const r of next) if (r.key.trim()) obj[r.key.trim()] = r.value;
    emitted.current = obj;
    onChange(obj);
  };

  return (
    <div className="rows">
      {rows.map((r) => (
        <div className="row kv" key={r.id}>
          <input
            type="text"
            className="kv-key"
            placeholder="Name"
            value={r.key}
            onChange={(e) => update(rows.map((x) => (x.id === r.id ? { ...x, key: e.target.value } : x)))}
            spellCheck={false}
          />
          <input
            type="text"
            placeholder={field.placeholder ?? 'Value'}
            value={r.value}
            onChange={(e) => update(rows.map((x) => (x.id === r.id ? { ...x, value: e.target.value } : x)))}
            spellCheck={false}
          />
          <button type="button" className="icon-btn" onClick={() => update(rows.filter((x) => x.id !== r.id))} aria-label="Remove row">
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button type="button" className="link-btn" onClick={() => setRows([...rows, { id: rowSeq++, key: '', value: '' }])}>
        <Plus size={13} /> Add row
      </button>
    </div>
  );
}

function ListField({ field, value, onChange }: { field: FieldDef; value: unknown; onChange: (v: unknown) => void }) {
  const items: string[] = Array.isArray(value) ? value.map((v) => stringify(v)) : typeof value === 'string' && value ? [value] : [];
  return (
    <div className="rows">
      {items.map((item, i) => (
        <div className="row" key={i}>
          <input
            type="text"
            value={item}
            placeholder={field.placeholder}
            onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
            spellCheck={false}
          />
          <button type="button" className="icon-btn" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label="Remove item">
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button type="button" className="link-btn" onClick={() => onChange([...items, ''])}>
        <Plus size={13} /> Add item
      </button>
    </div>
  );
}

/** Required fields that are still empty, as a field → message map. */
export function missingRequired(fields: FieldDef[], values: Record<string, unknown>, secretsSet: string[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    if (!f.required || !matchesShowIf(f, values, fields)) continue;
    if (f.type === 'secret' && secretsSet.includes(f.key)) continue;
    const v = values[f.key] ?? f.default;
    if (isEmpty(v)) out[f.key] = `${f.label} is required.`;
  }
  return out;
}
