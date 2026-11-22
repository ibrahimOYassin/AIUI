import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, FileJson, Rocket, ShieldCheck, Upload, XCircle } from 'lucide-react';
import type { DevListing, PluginManifest, ValidateManifestResponse } from '@aiui/shared';
import { slugify } from '@aiui/shared';
import { api, errorMessage } from '../api';
import { Badge, Button, ErrorBox, PageHeader, Spinner } from '../components/ui';
import { useApp } from '../stores/app';

function sampleManifest(developerName: string): PluginManifest {
  const owner = slugify(developerName || 'me').replace(/_/g, '') || 'me';
  return {
    id: `${owner}.shout`,
    name: 'Shout',
    version: '1.0.0',
    description: 'Turns any text into upper case. A minimal example plugin to start from.',
    author: developerName || 'Me',
    icon: 'megaphone',
    category: 'Text',
    nodes: [
      {
        type: `${owner}.shout.text`,
        label: 'Shout text',
        description: 'Convert text to upper case and add an exclamation mark.',
        kind: 'action',
        category: 'Text',
        icon: 'megaphone',
        inputs: [{ id: 'in', label: 'In' }],
        outputs: [{ id: 'out', label: 'Out' }],
        fields: [
          {
            key: 'text',
            label: 'Text',
            type: 'textarea',
            required: true,
            templated: true,
            placeholder: 'Hello from {{input.name}}',
            help: 'The text to shout.',
          },
          { key: 'exclaim', label: 'Add exclamation mark', type: 'boolean', default: true },
        ],
        outputFields: [{ key: 'text', label: 'Shouted text' }],
        codegen: {
          python: {
            source: [
              'def run(cfg, ctx):',
              '    text = str(cfg.get("text", "")).upper()',
              '    if cfg.get("exclaim", True):',
              '        text += "!"',
              '    ctx.log(f"Shouting {len(text)} characters")',
              '    return {"text": text}',
              '',
            ].join('\n'),
            requirements: [],
          },
          csharp: {
            className: 'ShoutTextStep',
            source: [
              'using System.Text.Json.Nodes;',
              'using Aiui.Runtime;',
              '',
              'namespace Aiui.Steps;',
              '',
              'public static class ShoutTextStep',
              '{',
              '    public static Task<JsonNode?> RunAsync(JsonObject cfg, StepContext ctx)',
              '    {',
              '        var text = J.Text(cfg["text"]).ToUpperInvariant();',
              '        if (J.Bool(cfg, "exclaim", true)) text += "!";',
              '        ctx.Log($"Shouting {text.Length} characters");',
              '        return Task.FromResult<JsonNode?>(new JsonObject { ["text"] = text });',
              '    }',
              '}',
              '',
            ].join('\n'),
            packages: [],
          },
        },
      },
    ],
    connectionTypes: [],
    templates: [],
  };
}

export function PluginEditorPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const user = useApp((s) => s.user)!;
  const toast = useApp((s) => s.toast);
  const loadCatalog = useApp((s) => s.loadCatalog);
  const editing = !!id;

  const [existing, setExisting] = useState<DevListing | null>(null);
  const [loading, setLoading] = useState(editing);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [summary, setSummary] = useState('');
  const [price, setPrice] = useState('0');
  const [tags, setTags] = useState('');
  const [changelog, setChangelog] = useState('');
  const [validation, setValidation] = useState<ValidateManifestResponse | null>(null);
  const [busy, setBusy] = useState<'validate' | 'save' | 'publish' | null>(null);

  useEffect(() => {
    if (!user.roles.includes('developer')) {
      navigate('/developer', { replace: true });
      return;
    }
    if (!editing) {
      if (params.get('example')) setText(JSON.stringify(sampleManifest(user.developerName ?? user.name), null, 2));
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const all = await api.devPlugins();
        const found = all.find((p) => p.id === id);
        if (cancelled) return;
        if (!found) {
          setLoadError('That plugin was not found in your listings.');
        } else {
          setExisting(found);
          setText(JSON.stringify(found.manifest, null, 2));
          setSummary(found.summary ?? '');
          setPrice((found.priceCents / 100).toFixed(2));
          setTags((found.tags ?? []).join(', '));
        }
      } catch (err) {
        if (!cancelled) setLoadError(errorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const parsed = useMemo<{ manifest: PluginManifest | null; error: string | null }>(() => {
    if (!text.trim()) return { manifest: null, error: null };
    try {
      const value: unknown = JSON.parse(text);
      if (!value || typeof value !== 'object' || Array.isArray(value)) return { manifest: null, error: 'The manifest must be a JSON object.' };
      return { manifest: value as PluginManifest, error: null };
    } catch (err) {
      return { manifest: null, error: err instanceof Error ? err.message : 'Not valid JSON' };
    }
  }, [text]);

  const priceNumber = Number(price);
  const priceValid = price.trim() !== '' && Number.isFinite(priceNumber) && priceNumber >= 0;
  const priceCents = priceValid ? Math.round(priceNumber * 100) : 0;
  const manifest = parsed.manifest;
  const versionChanged = !!existing && !!manifest && manifest.version !== existing.version;

  const validate = async (): Promise<boolean> => {
    if (!manifest) return false;
    const result = await api.devValidate(manifest);
    setValidation(result);
    return result.ok;
  };

  const onValidate = async () => {
    setBusy('validate');
    try {
      await validate();
    } catch (err) {
      setValidation({ ok: false, errors: [errorMessage(err)] });
    } finally {
      setBusy(null);
    }
  };

  const save = async (publish: boolean) => {
    if (!manifest || !priceValid) return;
    setBusy(publish ? 'publish' : 'save');
    try {
      if (!(await validate())) {
        toast('error', 'Fix the problems listed under the manifest, then save again.');
        return;
      }
      const body = {
        manifest,
        summary: summary.trim() || manifest.description,
        priceCents,
        tags: tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        changelog: changelog.trim() || undefined,
      };
      const saved = existing ? await api.devUpdate(existing.id, body) : await api.devCreate(body);
      if (publish) await api.devPublish(saved.id);
      await loadCatalog();
      toast('success', publish ? `${saved.name} is live in the Marketplace.` : `${saved.name} saved as ${saved.status === 'published' ? 'published' : 'a draft'}.`);
      navigate('/developer');
    } catch (err) {
      toast('error', errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const loadFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setText(String(reader.result ?? ''));
      setValidation(null);
    };
    reader.readAsText(file);
  };

  if (loading) {
    return (
      <div className="page">
        <Spinner label="Loading plugin…" />
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="page">
        <Link to="/developer" className="back-link">
          <ArrowLeft size={14} /> Developer portal
        </Link>
        <ErrorBox message={loadError} />
      </div>
    );
  }

  return (
    <div className="page">
      <Link to="/developer" className="back-link">
        <ArrowLeft size={14} /> Developer portal
      </Link>
      <PageHeader
        title={existing ? `Edit ${existing.name}` : 'New plugin'}
        subtitle={
          existing
            ? 'Raise the version in the manifest to release an update. Listing details can be changed at any time.'
            : 'Paste or write a manifest, check it, set a price, and publish.'
        }
        actions={
          <>
            <Button onClick={() => void save(false)} busy={busy === 'save'} disabled={!manifest || !priceValid || busy !== null}>
              {existing ? 'Save changes' : 'Save draft'}
            </Button>
            {(!existing || existing.status !== 'published') && (
              <Button variant="primary" icon={<Rocket size={16} />} onClick={() => void save(true)} busy={busy === 'publish'} disabled={!manifest || !priceValid || busy !== null}>
                Save and publish
              </Button>
            )}
          </>
        }
      />

      <div className="editor-cols">
        <section className="card card-pad">
          <div className="row-center">
            <h2 className="grow">
              <FileJson size={17} /> Manifest
            </h2>
            <Button size="sm" onClick={() => {
              setText(JSON.stringify(sampleManifest(user.developerName ?? user.name), null, 2));
              setValidation(null);
            }}>
              Start from example
            </Button>
            <label className="btn btn-default btn-sm">
              <Upload size={14} />
              <span>Upload .json</span>
              <input type="file" accept="application/json,.json" hidden onChange={(e) => loadFile(e.target.files?.[0])} />
            </label>
            <Button size="sm" icon={<ShieldCheck size={14} />} busy={busy === 'validate'} disabled={!manifest || busy !== null} onClick={() => void onValidate()}>
              Validate
            </Button>
          </div>
          <p className="muted small">
            The manifest describes the plugin: its steps, their form fields, and the Python and C# source each step generates. Nothing in
            a plugin runs inside the IDE — the code is only copied into generated projects.
          </p>
          <textarea
            className="mono manifest-editor"
            value={text}
            spellCheck={false}
            placeholder='Paste a manifest here, or click "Start from example".'
            onChange={(e) => {
              setText(e.target.value);
              setValidation(null);
            }}
          />
          {parsed.error && (
            <div className="test-result fail">
              <XCircle size={16} />
              <span>Not valid JSON yet: {parsed.error}</span>
            </div>
          )}
          {!parsed.error && !text.trim() && (
            <div className="hint-box">
              New to plugins? Click <strong>Start from example</strong> for a complete, valid plugin with one step.
            </div>
          )}
          {validation &&
            (validation.ok ? (
              <div className="test-result ok">
                <CheckCircle2 size={16} />
                <span>The manifest is valid and ready to publish.</span>
              </div>
            ) : (
              <div className="test-result fail block">
                <div className="row-center">
                  <XCircle size={16} />
                  <strong>
                    {validation.errors.length} problem{validation.errors.length === 1 ? '' : 's'} to fix
                  </strong>
                </div>
                <ul>
                  {validation.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            ))}
        </section>

        <aside>
          <section className="card card-pad">
            <h2>Listing</h2>
            {manifest && (
              <div className="manifest-summary">
                <strong>{manifest.name || 'Unnamed plugin'}</strong> <span className="muted small">v{manifest.version || '?'}</span>
                <div className="muted small">
                  <code>{manifest.id || 'no id'}</code> · {manifest.nodes?.length ?? 0} step{(manifest.nodes?.length ?? 0) === 1 ? '' : 's'}
                </div>
                {existing && (versionChanged ? <Badge tone="green">New version {manifest.version}</Badge> : <Badge tone="neutral">Same version as published</Badge>)}
              </div>
            )}
            <div className="fields">
              <div className="field">
                <div className="field-label">
                  <label>Summary</label>
                </div>
                <input type="text" value={summary} maxLength={140} placeholder={manifest?.description ?? 'One line shown on the listing card'} onChange={(e) => setSummary(e.target.value)} />
                <div className="field-help">One line shown on the listing card. Defaults to the manifest description.</div>
              </div>
              <div className={`field ${priceValid ? '' : 'field-problem'}`}>
                <div className="field-label">
                  <label>Price (USD)</label>
                </div>
                <div className="input-prefix">
                  <span>$</span>
                  <input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
                </div>
                {!priceValid && <div className="field-error">Enter a price of 0 or more.</div>}
                <div className="field-help">{priceCents === 0 ? 'Free — anyone can install it.' : `You receive $${((priceCents * 0.8) / 100).toFixed(2)} per sale (80%).`}</div>
              </div>
              <div className="field">
                <div className="field-label">
                  <label>Tags</label>
                </div>
                <input type="text" value={tags} placeholder="text, formatting" onChange={(e) => setTags(e.target.value)} />
                <div className="field-help">Separate with commas. Helps people find the plugin.</div>
              </div>
              <div className="field">
                <div className="field-label">
                  <label>What changed</label>
                </div>
                <textarea rows={3} value={changelog} placeholder={existing ? 'Shown next to this version on the listing page' : 'Initial release'} onChange={(e) => setChangelog(e.target.value)} />
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
