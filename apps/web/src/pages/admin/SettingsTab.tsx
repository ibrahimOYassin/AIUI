import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { PlatformSettings } from '@aiui/shared';
import { api, errorMessage } from '../../api';
import { Toggle } from '../../components/FieldForm';
import { Button, ErrorBox, Spinner } from '../../components/ui';
import { useApp } from '../../stores/app';

const RUN_OPTIONS: { id: PlatformSettings['runAccess']; label: string; help: string }[] = [
  { id: 'none', label: 'Nobody', help: 'Run is turned off for everyone. People export their project and run it on their own machine.' },
  { id: 'admins', label: 'Administrators only', help: 'Only people with the Admin role can press Run. Recommended for a public site.' },
  { id: 'all', label: 'Everyone', help: 'Every signed-in person can press Run.' },
];

export function SettingsTab() {
  const toast = useApp((s) => s.toast);
  const refreshSession = useApp((s) => s.refreshSession);
  const mode = useApp((s) => s.config?.mode);
  const [saved, setSaved] = useState<PlatformSettings | null>(null);
  const [draft, setDraft] = useState<PlatformSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const settings = await api.adminSettings();
      setSaved(settings);
      setDraft(settings);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorBox message={error} onRetry={() => void load()} />;
  if (!draft || !saved) return <Spinner label="Loading settings…" />;

  const dirty = draft.allowRegistration !== saved.allowRegistration || draft.runAccess !== saved.runAccess;
  const update = (patch: Partial<PlatformSettings>) => {
    setDraft({ ...draft, ...patch });
    setJustSaved(false);
  };

  const save = async () => {
    setBusy(true);
    try {
      const next = await api.adminSaveSettings(draft);
      setSaved(next);
      setDraft(next);
      setJustSaved(true);
      toast('success', 'Settings saved.');
      await refreshSession(); // your own Run permission and the sign-up page follow these settings
    } catch (err) {
      toast('error', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings">
      <section className="card card-pad">
        <div className="setting-row">
          <div>
            <h3>Allow new sign-ups</h3>
            <p className="muted">
              When on, anyone who can reach the site can create an account. When off, the sign-up page is closed and you create accounts
              yourself under Users.
            </p>
            {mode === 'local' && <p className="muted small">This installation runs in local mode, where there is no sign-up page; the setting applies once it runs in web mode.</p>}
          </div>
          <label className="row-center nowrap">
            <span className="muted small">{draft.allowRegistration ? 'Open' : 'Closed'}</span>
            <Toggle checked={draft.allowRegistration} onChange={(v) => update({ allowRegistration: v })} />
          </label>
        </div>
      </section>

      <section className="card card-pad">
        <h3>Who can run projects in the IDE</h3>
        <p className="muted">Run tests a project inside the IDE. Building, previewing code and exporting are always available to everyone.</p>
        <div className="radio-list" role="radiogroup" aria-label="Who can run projects in the IDE">
          {RUN_OPTIONS.map((o) => (
            <label key={o.id} className={`radio-card ${draft.runAccess === o.id ? 'selected' : ''}`}>
              <input type="radio" name="runAccess" checked={draft.runAccess === o.id} onChange={() => update({ runAccess: o.id })} />
              <span>
                <strong>{o.label}</strong>
                <small>{o.help}</small>
                {o.id === 'all' && (
                  <span className="radio-warning">
                    <AlertTriangle size={14} />
                    <span>
                      Running executes generated code on the server. Only enable it for people you trust.
                    </span>
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>
      </section>

      <div className="settings-foot">
        {justSaved && !dirty && (
          <span className="row-center saved-note">
            <CheckCircle2 size={15} /> Saved
          </span>
        )}
        {dirty && <span className="muted small">You have unsaved changes.</span>}
        <Button onClick={() => setDraft(saved)} disabled={!dirty || busy}>
          Discard
        </Button>
        <Button variant="primary" busy={busy} disabled={!dirty} onClick={() => void save()}>
          Save settings
        </Button>
      </div>
    </div>
  );
}
