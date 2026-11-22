import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Copy, Download, FileCode2, FileJson, FileText, Folder, RefreshCw } from 'lucide-react';
import type { GenerateResponse, GeneratedFile, Language } from '@aiui/shared';
import { slugify } from '@aiui/shared';
import { api, downloadBlob, errorMessage } from '../api';
import { Button, ErrorBox, Spinner } from '../components/ui';
import { type Token, languageOf, tokenize } from '../lib/highlight';
import { useApp } from '../stores/app';
import { useEditor } from '../stores/editor';

const LANG_LABEL: Record<Language, string> = { python: 'Python', csharp: 'C#' };

function fileIcon(path: string) {
  if (/\.(py|cs)$/i.test(path)) return <FileCode2 size={14} />;
  if (/\.json$/i.test(path)) return <FileJson size={14} />;
  return <FileText size={14} />;
}

/** Entry files first, then folders, alphabetical within each. */
function sortFiles(files: GeneratedFile[]): GeneratedFile[] {
  const rank = (p: string) => {
    const lower = p.toLowerCase();
    if (lower === 'main.py' || lower === 'program.cs') return 0;
    if (lower === 'workflow.py' || lower === 'workflow.cs') return 1;
    if (lower === 'readme.md') return 2;
    return p.includes('/') ? 4 : 3;
  };
  return [...files].sort((a, b) => rank(a.path) - rank(b.path) || a.path.localeCompare(b.path));
}

function toLines(tokens: Token[]): Token[][] {
  const lines: Token[][] = [[]];
  for (const token of tokens) {
    const parts = token.text.split('\n');
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ kind: token.kind, text: part });
    });
  }
  return lines;
}

export async function exportProject(language: Language) {
  const ed = useEditor.getState();
  const project = ed.project;
  if (!project) return;
  const toast = useApp.getState().toast;
  try {
    await ed.flushSave();
    const blob = await api.exportZip(project.id, language);
    downloadBlob(blob, `${slugify(project.name) || 'project'}-${language}.zip`);
    toast('success', `${LANG_LABEL[language]} project downloaded.`);
  } catch (err) {
    toast('error', `Export failed: ${errorMessage(err)}`);
  }
}

export function CodeView() {
  const project = useEditor((s) => s.project);
  const savedVersion = useEditor((s) => s.savedVersion);
  const [language, setLanguage] = useState<Language>(() => {
    try {
      const stored = localStorage.getItem('aiui.codeLang');
      if (stored === 'python' || stored === 'csharp') return stored;
    } catch {
      /* ignore */
    }
    return project?.settings?.defaultLanguage ?? 'python';
  });
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [path, setPath] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [nonce, setNonce] = useState(0);
  const projectId = project?.id;

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        await useEditor.getState().flushSave();
        const res = await api.generate(projectId, language);
        if (cancelled) return;
        setResult(res);
        setPath((current) => (current && res.files.some((f) => f.path === current) ? current : (sortFiles(res.files)[0]?.path ?? null)));
      } catch (err) {
        if (!cancelled) setError(errorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, language, savedVersion, nonce]);

  const files = useMemo(() => sortFiles(result?.files ?? []), [result]);
  const file = files.find((f) => f.path === path) ?? files[0];
  const lines = useMemo(() => (file ? toLines(tokenize(file.content, languageOf(file.path))) : []), [file]);
  const errors = result?.issues.filter((i) => i.severity === 'error') ?? [];

  const chooseLanguage = (lang: Language) => {
    setLanguage(lang);
    setPath(null);
    try {
      localStorage.setItem('aiui.codeLang', lang);
    } catch {
      /* ignore */
    }
  };

  const copy = async () => {
    if (!file) return;
    try {
      await navigator.clipboard.writeText(file.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      useApp.getState().toast('error', 'Could not copy. Select the text and copy it manually.');
    }
  };

  let lastFolder = '';
  return (
    <div className="code-view">
      <div className="code-bar">
        <div className="segmented">
          {(Object.keys(LANG_LABEL) as Language[]).map((l) => (
            <button key={l} type="button" className={language === l ? 'active' : ''} onClick={() => chooseLanguage(l)}>
              {LANG_LABEL[l]}
            </button>
          ))}
        </div>
        <span className="muted small">Generated from your project. Read-only — change the steps and this updates.</span>
        <span className="grow" />
        <Button size="sm" icon={<RefreshCw size={14} />} onClick={() => setNonce((n) => n + 1)} disabled={loading}>
          Refresh
        </Button>
        <Button size="sm" icon={copied ? <Check size={14} /> : <Copy size={14} />} onClick={() => void copy()} disabled={!file}>
          {copied ? 'Copied' : 'Copy file'}
        </Button>
        <Button
          size="sm"
          variant="primary"
          icon={<Download size={14} />}
          busy={exporting}
          onClick={() => {
            setExporting(true);
            void exportProject(language).finally(() => setExporting(false));
          }}
        >
          Download {LANG_LABEL[language]} project
        </Button>
      </div>
      {errors.length > 0 && (
        <div className="code-warning">
          <AlertTriangle size={14} />
          <span>
            {errors.length} problem{errors.length === 1 ? '' : 's'} in the project — the generated code may not run until{' '}
            {errors.length === 1 ? 'it is' : 'they are'} fixed.
          </span>
          <button type="button" className="link-btn" onClick={() => useEditor.getState().setBottom('problems')}>
            Show problems
          </button>
        </div>
      )}
      {error ? (
        <div className="code-msg">
          <ErrorBox message={error} onRetry={() => setNonce((n) => n + 1)} />
        </div>
      ) : !result ? (
        <div className="code-msg">
          <Spinner label="Generating code…" />
        </div>
      ) : files.length === 0 ? (
        <div className="code-msg">
          <p className="muted">Nothing to generate yet. Add a trigger and at least one step.</p>
        </div>
      ) : (
        <div className={`code-body ${loading ? 'loading' : ''}`}>
          <nav className="file-tree" aria-label="Generated files">
            {files.map((f) => {
              const slash = f.path.lastIndexOf('/');
              const folder = slash >= 0 ? f.path.slice(0, slash) : '';
              const name = slash >= 0 ? f.path.slice(slash + 1) : f.path;
              const showFolder = folder !== '' && folder !== lastFolder;
              lastFolder = folder;
              return (
                <div key={f.path}>
                  {showFolder && (
                    <div className="file-folder">
                      <Folder size={14} /> {folder}
                    </div>
                  )}
                  <button type="button" className={`file ${folder ? 'nested' : ''} ${file?.path === f.path ? 'active' : ''}`} onClick={() => setPath(f.path)} title={f.path}>
                    {fileIcon(f.path)} {name}
                  </button>
                </div>
              );
            })}
          </nav>
          <div className="code-pane">
            <div className="code-path">
              {file?.path} <span className="muted">· {lines.length} lines</span>
            </div>
            <pre className="code">
              <code>
                {lines.map((line, i) => (
                  <div key={i} className="code-line">
                    <span className="ln">{i + 1}</span>
                    <span className="lc">
                      {line.length === 0
                        ? '\n'
                        : line.map((t, j) =>
                            t.kind === 'plain' ? (
                              t.text
                            ) : (
                              <span key={j} className={`tok-${t.kind}`}>
                                {t.text}
                              </span>
                            ),
                          )}
                    </span>
                  </div>
                ))}
              </code>
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
