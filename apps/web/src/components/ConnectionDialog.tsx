import { useMemo, useState } from 'react';
import { CheckCircle2, PlugZap, XCircle } from 'lucide-react';
import type { ConnectionTypeInfo, TestConnectionResult } from '@aiui/shared';
import { api, errorMessage } from '../api';
import { Icon } from '../lib/icons';
import { type ConnectionDialogRequest, useApp } from '../stores/app';
import { FieldsForm, missingRequired } from './FieldForm';
import { Button, EmptyState, Modal } from './ui';

export function ConnectionDialogHost() {
  const req = useApp((s) => s.connectionDialog);
  if (!req) return null;
  return <ConnectionDialog req={req} />;
}

function defaults(type: ConnectionTypeInfo | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of type?.fields ?? []) if (f.default !== undefined) out[f.key] = f.default;
  return out;
}

function ConnectionDialog({ req }: { req: ConnectionDialogRequest }) {
  const types = useApp((s) => s.catalog.connectionTypes);
  const close = useApp((s) => s.closeConnectionDialog);
  const reload = useApp((s) => s.loadConnections);
  const toast = useApp((s) => s.toast);
  const editing = req.connection;

  const [typeId, setTypeId] = useState<string | null>(editing?.type ?? req.type ?? null);
  const type = useMemo(() => types.find((t) => t.type === typeId), [types, typeId]);
  const [name, setName] = useState(editing?.name ?? '');
  const [values, setValues] = useState<Record<string, unknown>>(() => editing?.values ?? defaults(types.find((t) => t.type === (req.type ?? ''))));
  const [savedId, setSavedId] = useState<string | null>(editing?.id ?? null);
  const [secretsSet, setSecretsSet] = useState<string[]>(editing?.secretsSet ?? []);
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [test, setTest] = useState<TestConnectionResult | null>(null);
  const [showProblems, setShowProblems] = useState(false);

  const chooseType = (t: ConnectionTypeInfo) => {
    setTypeId(t.type);
    setValues(defaults(t));
    if (!name) setName(t.label);
  };

  const problems = type ? missingRequired(type.fields, values, secretsSet) : {};
  const nameMissing = !name.trim();

  /** Secrets are only sent when the user typed something. */
  const payloadValues = () => {
    const out: Record<string, unknown> = {};
    for (const f of type?.fields ?? []) {
      const v = values[f.key];
      if (f.type === 'secret') {
        if (typeof v === 'string' && v !== '') out[f.key] = v;
      } else if (v !== undefined) out[f.key] = v;
    }
    return out;
  };

  const save = async () => {
    if (!type) return null;
    if (nameMissing || Object.keys(problems).length) {
      setShowProblems(true);
      return null;
    }
    const body = { name: name.trim(), type: type.type, values: payloadValues() };
    const saved = savedId ? await api.updateConnection(savedId, body) : await api.createConnection(body);
    setSavedId(saved.id);
    setSecretsSet(saved.secretsSet ?? []);
    // typed secrets are now stored; clear them so they are not re-sent
    setValues((v) => {
      const next = { ...v };
      for (const f of type.fields) if (f.type === 'secret') delete next[f.key];
      return next;
    });
    await reload();
    return saved;
  };

  const onSave = async () => {
    setBusy('save');
    try {
      const saved = await save();
      if (saved) {
        toast('success', `Connection "${saved.name}" saved.`);
        close(saved);
      }
    } catch (err) {
      toast('error', errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const onTest = async () => {
    setBusy('test');
    setTest(null);
    try {
      const saved = await save();
      if (saved) setTest(await api.testConnection(saved.id));
    } catch (err) {
      setTest({ ok: false, message: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  const dismiss = () => {
    // If Test already saved the connection, hand it back so a step can use it.
    const saved = savedId ? useApp.getState().connections.find((c) => c.id === savedId) ?? null : null;
    close(editing ? saved : saved);
  };

  if (!type) {
    return (
      <Modal title="New connection" onClose={() => close(null)} width={560}>
        {types.length === 0 ? (
          <EmptyState icon={<PlugZap size={22} />} title="No connection types available">
            Install a plugin from the Marketplace that adds connections, such as AI or Email.
          </EmptyState>
        ) : (
          <>
            <p className="muted" style={{ marginTop: 0 }}>
              What do you want to connect to?
            </p>
            <div className="choice-grid">
              {types.map((t) => (
                <button key={t.type} type="button" className="choice" onClick={() => chooseType(t)}>
                  <span className="choice-icon">
                    <Icon name={t.icon} size={18} />
                  </span>
                  <span>
                    <strong>{t.label}</strong>
                    <small>{t.description}</small>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </Modal>
    );
  }

  return (
    <Modal
      title={
        <span className="row-center">
          <Icon name={type.icon} size={17} /> {editing ? `Edit ${type.label}` : `New ${type.label}`}
        </span>
      }
      onClose={dismiss}
      width={560}
      footer={
        <>
          <Button onClick={() => void onTest()} busy={busy === 'test'} disabled={busy !== null} icon={<PlugZap size={15} />}>
            Test
          </Button>
          <span className="grow" />
          <Button onClick={dismiss}>Cancel</Button>
          <Button variant="primary" onClick={() => void onSave()} busy={busy === 'save'} disabled={busy !== null}>
            Save connection
          </Button>
        </>
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>
        {type.description}
      </p>
      {type.presets && type.presets.length > 0 && (
        <div className="presets">
          <span className="muted small">Quick setup:</span>
          {type.presets.map((p) => (
            <button
              key={p.label}
              type="button"
              className="chip"
              onClick={() => {
                setValues((v) => ({ ...v, ...p.values }));
                if (!name.trim() || name === type.label || type.presets?.some((x) => x.label === name)) setName(p.label);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
      <div className="fields">
        <div className={`field ${showProblems && nameMissing ? 'field-problem' : ''}`}>
          <div className="field-label">
            <label>
              Name<span className="req">*</span>
            </label>
          </div>
          <input type="text" value={name} autoFocus={!editing} placeholder="e.g. My OpenAI key" onChange={(e) => setName(e.target.value)} />
          {showProblems && nameMissing && <div className="field-error">Give the connection a name.</div>}
          <div className="field-help">Shown when you pick this connection in a step.</div>
        </div>
      </div>
      <FieldsForm
        fields={type.fields}
        values={values}
        onChange={(key, value) => setValues((v) => ({ ...v, [key]: value }))}
        secretsSet={secretsSet}
        problems={showProblems ? problems : undefined}
      />
      {!req.lockType && !editing && !savedId && (
        <button type="button" className="link-btn" style={{ marginTop: 10 }} onClick={() => setTypeId(null)}>
          Choose a different type
        </button>
      )}
      {test && (
        <div className={`test-result ${test.ok ? 'ok' : 'fail'}`}>
          {test.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
          <span>{test.message || (test.ok ? 'Connection works.' : 'Connection failed.')}</span>
        </div>
      )}
      <p className="muted small" style={{ marginBottom: 0 }}>
        Secrets are encrypted and never shown again or written into generated code.
      </p>
    </Modal>
  );
}
