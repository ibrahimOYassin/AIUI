import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ShieldCheck, Sparkles, XCircle } from 'lucide-react';
import type { AssistantSettings, SaveAssistantSettingsRequest, TestConnectionResult } from '@aiui/shared';
import { api, errorMessage } from '../../api';
import { Toggle } from '../../components/FieldForm';
import { Button, ErrorBox, Spinner } from '../../components/ui';
import { useApp } from '../../stores/app';

type Draft = Omit<AssistantSettings, 'apiKeySet'>;

const CLAUDE_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-2'];

const ACCESS: { id: AssistantSettings['access']; label: string; help: string }[] = [
  { id: 'users', label: 'Signed-in people', help: 'Everyone with an account. It can read their own projects and connections, never anyone else’s.' },
  { id: 'everyone', label: 'Everyone, guests included', help: 'Guests can ask about AIUI and the documentation. Questions are limited per address each day.' },
];

const strip = ({ apiKeySet: _ignored, ...rest }: AssistantSettings): Draft => rest;
const same = (a: Draft, b: Draft) => (Object.keys(a) as (keyof Draft)[]).every((k) => a[k] === b[k]);

export function AssistantTab() {
  const toast = useApp((s) => s.toast);
  const refreshSession = useApp((s) => s.refreshSession);
  const [saved, setSaved] = useState<AssistantSettings | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestConnectionResult | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const settings = await api.adminAssistant();
      setSaved(settings);
      setDraft(strip(settings));
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorBox message={error} onRetry={() => void load()} />;
  if (!draft || !saved) return <Spinner label="Loading the assistant settings…" />;

  const dirty = !same(draft, strip(saved)) || apiKey.trim() !== '' || clearKey;
  const update = (patch: Partial<Draft>) => {
    setDraft({ ...draft, ...patch });
    setTest(null);
  };
  const body = (): SaveAssistantSettingsRequest => ({ ...draft, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}), ...(clearKey ? { clearApiKey: true } : {}) });
  const keyStored = saved.apiKeySet && !clearKey;
  const claude = draft.provider === 'anthropic';

  const save = async () => {
    setBusy(true);
    try {
      const next = await api.adminSaveAssistant(body());
      setSaved(next);
      setDraft(strip(next));
      setApiKey('');
      setClearKey(false);
      toast('success', next.enabled ? `${next.name} is on.` : 'Assistant settings saved.');
      await refreshSession(); // the rail button follows the setting
    } catch (err) {
      toast('error', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      setTest(await api.adminTestAssistant(body()));
    } catch (err) {
      setTest({ ok: false, message: errorMessage(err) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="settings">
      <section className="card card-pad">
        <div className="setting-row">
          <div>
            <h3 className="row-center">
              <Sparkles size={17} /> AI Assistant
            </h3>
            <p className="muted">
              A chat assistant everyone can open from the side bar. It answers from the AIUI documentation and reads the projects and connections
              of the person asking, so it can explain them, find problems and suggest next steps. It only reads; it cannot change anything.
            </p>
          </div>
          <label className="row-center nowrap">
            <span className="muted small">{draft.enabled ? 'On' : 'Off'}</span>
            <Toggle checked={draft.enabled} onChange={(v) => update({ enabled: v })} />
          </label>
        </div>
        <p className="row-center muted small assistant-privacy">
          <ShieldCheck size={15} /> Each person’s questions and data go to the model you choose below. Secrets such as API keys are never included.
        </p>
      </section>

      <section className="card card-pad">
        <h3>Model</h3>
        <div className="fields">
          <div className="radio-list" role="radiogroup" aria-label="Provider">
            <label className={`radio-card ${claude ? 'selected' : ''}`}>
              <input type="radio" name="provider" checked={claude} onChange={() => update({ provider: 'anthropic', model: CLAUDE_MODELS[0], baseUrl: '' })} />
              <span>
                <strong>Claude (Anthropic)</strong>
                <small>The best answers. Uses the Claude API with your Anthropic API key; each question costs a little.</small>
              </span>
            </label>
            <label className={`radio-card ${!claude ? 'selected' : ''}`}>
              <input type="radio" name="provider" checked={!claude} onChange={() => update({ provider: 'openai', model: '', baseUrl: '' })} />
              <span>
                <strong>OpenAI-compatible</strong>
                <small>A model on your own Ollama, LM Studio or vLLM server (free to run), or OpenAI. The model must support tool calling.</small>
              </span>
            </label>
          </div>
          <div className="field">
            <div className="field-label">
              <label htmlFor="assistant-model">
                Model<span className="req">*</span>
              </label>
            </div>
            <input id="assistant-model" type="text" list={claude ? 'assistant-claude-models' : undefined} value={draft.model} placeholder={claude ? 'claude-opus-5-5' : 'e.g. lfm3 or llama3.1'} onChange={(e) => update({ model: e.target.value })} />
            {claude && (
              <datalist id="assistant-claude-models">
                {CLAUDE_MODELS.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            )}
            <div className="field-help">
              {claude
                ? 'Claude Opus 5.5 gives the best answers. Claude Sonnet 5.5 or Haiku 5.5 cost less per question.'
                : 'The model name as your server knows it (for Ollama, as in "ollama list").'}
            </div>
          </div>
          <div className="field">
            <div className="field-label">
              <label htmlFor="assistant-key">API key</label>
              {saved.apiKeySet && (
                <button type="button" className="link-btn" onClick={() => setClearKey(!clearKey)}>
                  {clearKey ? 'Keep the stored key' : 'Remove the stored key'}
                </button>
              )}
            </div>
            <input
              id="assistant-key"
              type="password"
              autoComplete="new-password"
              value={apiKey}
              placeholder={keyStored ? '•••••••• stored. Type a new key to replace it.' : claude ? 'sk-ant-…' : 'Leave empty if your server needs none'}
              onChange={(e) => {
                setApiKey(e.target.value);
                setTest(null);
              }}
            />
            <div className="field-help">
              Stored encrypted on the server and never shown again.
              {claude && !keyStored && ' Without one, the server’s ANTHROPIC_API_KEY setting is used.'}
            </div>
          </div>
          <div className="field">
            <div className="field-label">
              <label htmlFor="assistant-base">Base URL</label>
            </div>
            <input id="assistant-base" type="url" value={draft.baseUrl} placeholder={claude ? 'Empty = https://api.anthropic.com' : 'e.g. http://192.168.1.20:11434/v1 for Ollama. Empty = https://api.openai.com/v1'} onChange={(e) => update({ baseUrl: e.target.value })} />
          </div>
          <div className="row-center wrap">
            <Button busy={testing} onClick={() => void runTest()} disabled={!draft.model.trim()}>
              Test
            </Button>
            <span className="muted small">Asks the model for one short sentence with these settings, saved or not.</span>
          </div>
          {test && (
            <div className={`test-result ${test.ok ? 'ok' : 'fail'}`}>
              {test.ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
              <span>{test.message}</span>
            </div>
          )}
        </div>
      </section>

      <section className="card card-pad">
        <h3>Who can use it</h3>
        <div className="radio-list" role="radiogroup" aria-label="Who can use the assistant">
          {ACCESS.map((o) => (
            <label key={o.id} className={`radio-card ${draft.access === o.id ? 'selected' : ''}`}>
              <input type="radio" name="assistantAccess" checked={draft.access === o.id} onChange={() => update({ access: o.id })} />
              <span>
                <strong>{o.label}</strong>
                <small>{o.help}</small>
              </span>
            </label>
          ))}
        </div>
        <div className="fields" style={{ marginTop: 14 }}>
          <div className="field">
            <div className="field-label">
              <label htmlFor="assistant-limit">Questions per person per day</label>
            </div>
            <input id="assistant-limit" type="number" min={0} max={100000} step={1} value={draft.dailyLimit} onChange={(e) => update({ dailyLimit: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
            <div className="field-help">Keeps the cost under control. 0 means no limit.</div>
          </div>
        </div>
      </section>

      <section className="card card-pad">
        <h3>Personality and knowledge</h3>
        <div className="fields">
          <div className="field">
            <div className="field-label">
              <label htmlFor="assistant-name">Name</label>
            </div>
            <input id="assistant-name" type="text" maxLength={60} value={draft.name} onChange={(e) => update({ name: e.target.value })} />
          </div>
          <div className="field">
            <div className="field-label">
              <label htmlFor="assistant-greeting">Greeting</label>
            </div>
            <textarea id="assistant-greeting" rows={2} maxLength={500} value={draft.greeting} onChange={(e) => update({ greeting: e.target.value })} />
            <div className="field-help">The first message people see when they open the assistant.</div>
          </div>
          <div className="field">
            <div className="field-label">
              <label htmlFor="assistant-instructions">Instructions</label>
            </div>
            <textarea
              id="assistant-instructions"
              rows={5}
              maxLength={8000}
              value={draft.instructions}
              placeholder="For example: Answer in the language the person writes in. Recommend the Email plugin for notifications. Keep answers under 150 words."
              onChange={(e) => update({ instructions: e.target.value })}
            />
            <div className="field-help">How it should behave, on top of the built-in rules.</div>
          </div>
          <div className="field">
            <div className="field-label">
              <label htmlFor="assistant-knowledge">Extra knowledge</label>
              <span className="muted small">{draft.knowledge.length.toLocaleString()} / 50,000</span>
            </div>
            <textarea
              id="assistant-knowledge"
              rows={8}
              maxLength={50000}
              value={draft.knowledge}
              placeholder={'## Our AI models\nUse the "Company Claude" connection; ask IT for access.\n\n## Support\nWrite to the help desk for anything the assistant cannot answer.'}
              onChange={(e) => update({ knowledge: e.target.value })}
            />
            <div className="field-help">
              Facts about your own setup, searched together with the AIUI documentation. Markdown headings (## …) split it into sections.
            </div>
          </div>
        </div>
      </section>

      <div className="settings-foot">
        {dirty && <span className="muted small">You have unsaved changes.</span>}
        <Button
          onClick={() => {
            setDraft(strip(saved));
            setApiKey('');
            setClearKey(false);
            setTest(null);
          }}
          disabled={!dirty || busy}
        >
          Discard
        </Button>
        <Button variant="primary" busy={busy} disabled={!dirty} onClick={() => void save()}>
          Save
        </Button>
      </div>
    </div>
  );
}
