import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, BookOpen, Copy, FilePlus2, FolderOpen, LogIn, MoreHorizontal, Plus, Sparkles, Trash2, UserPlus } from 'lucide-react';
import type { ProjectSummary, ProjectType, TemplateInfo } from '@aiui/shared';
import { api, errorMessage } from '../api';
import { Badge, Button, EmptyState, ErrorBox, Modal, PageHeader, Popover, Spinner } from '../components/ui';
import { WelcomeTips } from '../components/WelcomeTips';
import { AboutAiui, GuestHero } from '../components/AboutAiui';
import { PROJECT_TYPES, timeAgo } from '../lib/format';
import { Icon } from '../lib/icons';
import { PUBLIC_PAGES, usePageMeta } from '../lib/site';
import { useApp } from '../stores/app';

const TYPE_TONE: Record<ProjectType, 'blue' | 'purple' | 'green'> = { workflow: 'blue', agent: 'purple', solution: 'green' };
/** The template the welcome tips walk through. */
const FIRST_AGENT_TEMPLATE = 'aiui.ai.support-agent';

interface WizardStart {
  template?: TemplateInfo;
  type?: ProjectType;
  /** Start blank (skip the template step). */
  blank?: boolean;
  name?: string;
}

export function HomePage() {
  usePageMeta(PUBLIC_PAGES.home);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const user = useApp((s) => s.user);
  const templates = useApp((s) => s.catalog.templates);
  const toast = useApp((s) => s.toast);
  const askConfirm = useApp((s) => s.askConfirm);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wizard, setWizard] = useState<WizardStart | null>(null);
  const impersonating = useApp((s) => !!s.impersonator);
  // A new account sees the welcome tips on its first visit; "?tips=1" (from Docs) opens them again.
  // Not when the visitor arrives to create a project (e.g. right after signing up for it): that comes first.
  const [tipsOpen, setTipsOpen] = useState(
    () => !!user && user.tipsSeenAt === null && !impersonating && !params.get('new') && !params.get('template'),
  );

  const load = useCallback(async () => {
    if (!useApp.getState().user) return; // guests have no projects yet
    setError(null);
    try {
      setProjects(await api.projects());
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, user]);

  useEffect(() => {
    // "?new=1" and "?template=…" open the new-project wizard, e.g. after signing in to create a project.
    const name = params.get('name') ?? undefined;
    const type = params.get('type') as ProjectType | null;
    if (params.get('new')) {
      setWizard({ type: type && type in PROJECT_TYPES ? type : undefined, blank: params.get('blank') === '1', name });
      for (const key of ['new', 'type', 'blank', 'name']) params.delete(key);
      setParams(params, { replace: true });
    } else if (params.get('template')) {
      const template = templates.find((t) => t.id === params.get('template'));
      if (!template && !templates.length) return; // the catalog is still loading
      if (template) setWizard({ template, name });
      params.delete('template');
      params.delete('name');
      setParams(params, { replace: true });
    } else if (params.get('tips')) {
      setTipsOpen(true);
      params.delete('tips');
      setParams(params, { replace: true });
    }
  }, [params, setParams, templates]);

  const createFirstAgent = () => {
    const template = templates.find((t) => t.id === FIRST_AGENT_TEMPLATE) ?? templates.find((t) => t.type === 'agent');
    setWizard(template ? { template } : { type: 'agent' });
  };

  const duplicate = async (p: ProjectSummary) => {
    try {
      const copy = await api.duplicateProject(p.id);
      toast('success', `Created "${copy.name}".`);
      void load();
    } catch (err) {
      toast('error', errorMessage(err));
    }
  };

  const remove = async (p: ProjectSummary) => {
    const ok = await askConfirm({
      title: 'Delete project?',
      message: `"${p.name}" and all of its steps will be deleted. This cannot be undone.`,
      confirmLabel: 'Delete project',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteProject(p.id);
      toast('success', 'Project deleted.');
      void load();
    } catch (err) {
      toast('error', errorMessage(err));
    }
  };

  const sorted = useMemo(
    () => (projects ? [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) : null),
    [projects],
  );

  return (
    <div className="page">
      {user ? (
      <PageHeader
        title={user ? `Welcome, ${user.name.split(' ')[0]}` : 'Welcome'}
        subtitle="Build AI workflows, agents and multi-agent solutions — no code needed."
        actions={
          <>
            <Button icon={<Sparkles size={16} />} onClick={() => setTipsOpen(true)} title="How to build and run your first AI Agent">
              Tips
            </Button>
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => setWizard({})}>
              New project
            </Button>
          </>
        }
      />
      ) : (
        <GuestHero onNewProject={() => setWizard({})} onTips={() => setTipsOpen(true)} />
      )}

      {user && <h2 className="section-title">Your projects</h2>}
      {user && error && <ErrorBox message={error} onRetry={() => void load()} />}
      {user && !error && sorted === null && <Spinner label="Loading projects…" />}
      {user && sorted && sorted.length === 0 && (
        <div className="card">
          <EmptyState
            icon={<FilePlus2 size={24} />}
            title="Create your first project"
            action={
              <Button variant="primary" icon={<Plus size={16} />} onClick={() => setWizard({})}>
                New project
              </Button>
            }
          >
            Pick what you want to build, start from a ready-made template or a blank page, and add steps one at a time.
            <br />
            <button type="button" className="link-btn" onClick={() => navigate('/docs')}>
              <BookOpen size={14} /> New here? Read the getting-started guide
            </button>
          </EmptyState>
        </div>
      )}
      {user && sorted && sorted.length > 0 && (
        <div className="grid cards">
          {sorted.map((p) => (
            <article key={p.id} className="card project-card" onClick={() => navigate(`/projects/${p.id}`)}>
              <div className="project-card-top">
                <span className={`tile tile-${p.type}`}>
                  <Icon name={PROJECT_TYPES[p.type]?.icon ?? 'workflow'} size={18} />
                </span>
                <Badge tone={TYPE_TONE[p.type] ?? 'neutral'}>{PROJECT_TYPES[p.type]?.label ?? p.type}</Badge>
                <span className="grow" />
                <span onClick={(e) => e.stopPropagation()}>
                  <Popover
                    align="right"
                    width={170}
                    trigger={(_, toggle) => (
                      <button type="button" className="icon-btn" onClick={toggle} aria-label="Project actions">
                        <MoreHorizontal size={16} />
                      </button>
                    )}
                  >
                    {(close) => (
                      <div className="menu">
                        <button type="button" onClick={() => navigate(`/projects/${p.id}`)}>
                          <FolderOpen size={14} /> Open
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            close();
                            void duplicate(p);
                          }}
                        >
                          <Copy size={14} /> Duplicate
                        </button>
                        <button
                          type="button"
                          className="danger"
                          onClick={() => {
                            close();
                            void remove(p);
                          }}
                        >
                          <Trash2 size={14} /> Delete
                        </button>
                      </div>
                    )}
                  </Popover>
                </span>
              </div>
              <h3>{p.name}</h3>
              <p className="muted clamp-2">{p.description || 'No description'}</p>
              <div className="project-card-foot muted small">
                <span>
                  {p.stepCount} step{p.stepCount === 1 ? '' : 's'}
                </span>
                <span>Edited {timeAgo(p.updatedAt)}</span>
              </div>
            </article>
          ))}
        </div>
      )}

      {templates.length > 0 && (
        <>
          <h2 className="section-title">Start from a template</h2>
          <div className="grid cards">
            {templates.map((t) => (
              <article key={`${t.pluginId}:${t.id}`} className="card template-card" onClick={() => setWizard({ template: t })}>
                <span className={`tile tile-${t.type}`}>
                  <Icon name={t.icon} size={18} />
                </span>
                <div>
                  <h3>{t.name}</h3>
                  <p className="muted clamp-2">{t.description}</p>
                  <Badge tone={TYPE_TONE[t.type] ?? 'neutral'}>{PROJECT_TYPES[t.type]?.label ?? t.type}</Badge>
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      {!user && <AboutAiui onNewProject={() => setWizard({})} />}

      {wizard && <NewProjectWizard start={wizard} onClose={() => setWizard(null)} />}
      {tipsOpen && <WelcomeTips onClose={() => setTipsOpen(false)} onCreateAgent={createFirstAgent} />}
    </div>
  );
}

function NewProjectWizard({ start, onClose }: { start: WizardStart; onClose: () => void }) {
  const navigate = useNavigate();
  const templates = useApp((s) => s.catalog.templates);
  const toast = useApp((s) => s.toast);
  const signedIn = useApp((s) => !!s.user);
  const allowRegistration = useApp((s) => s.config?.allowRegistration ?? true);
  const initialTemplate = start.template;
  const initialType = start.type;
  const [type, setType] = useState<ProjectType | null>(initialTemplate?.type ?? initialType ?? null);
  const [template, setTemplate] = useState<TemplateInfo | null | undefined>(initialTemplate ?? (start.blank && initialType ? null : undefined));
  const [name, setName] = useState(start.name ?? initialTemplate?.name ?? (start.blank && initialType ? `My ${PROJECT_TYPES[initialType].label.toLowerCase()}` : ''));
  const [description, setDescription] = useState(initialTemplate?.description ?? '');
  const [busy, setBusy] = useState(false);

  const step: 1 | 2 | 3 = type === null ? 1 : template === undefined ? 2 : 3;
  const forType = templates.filter((t) => t.type === type);

  const pickTemplate = (t: TemplateInfo | null) => {
    setTemplate(t);
    setName(t ? t.name : `My ${PROJECT_TYPES[type!].label.toLowerCase()}`);
    setDescription(t?.description ?? '');
  };

  const back = () => {
    if (step === 3) setTemplate(undefined);
    else if (step === 2) setType(null);
  };

  // A project belongs to an account: guests sign in (or sign up) here and come back to this step.
  const signInToCreate = (page: '/signin' | '/register') => {
    if (!type) return;
    const back = new URLSearchParams(template ? { template: template.id } : { new: '1', type, blank: '1' });
    if (name.trim()) back.set('name', name.trim());
    onClose();
    navigate(page, { state: { from: `/?${back}` } });
  };

  const create = async () => {
    if (!type || !name.trim()) return;
    if (!signedIn) return signInToCreate(allowRegistration ? '/register' : '/signin');
    setBusy(true);
    try {
      const project = await api.createProject({
        name: name.trim(),
        description: description.trim() || undefined,
        type,
        templateId: template?.id,
      });
      onClose();
      navigate(`/projects/${project.id}`);
    } catch (err) {
      toast('error', errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={step === 1 ? 'What do you want to build?' : step === 2 ? 'How do you want to start?' : 'Name your project'}
      onClose={onClose}
      width={640}
      footer={
        <>
          {step > 1 && (
            <Button icon={<ArrowLeft size={15} />} onClick={back}>
              Back
            </Button>
          )}
          <span className="muted small">Step {step} of 3</span>
          <span className="grow" />
          <Button onClick={onClose}>Cancel</Button>
          {step === 3 && signedIn && (
            <Button variant="primary" onClick={() => void create()} busy={busy} disabled={!name.trim()}>
              Create and open
            </Button>
          )}
          {step === 3 && !signedIn && (
            <>
              <Button icon={<LogIn size={15} />} onClick={() => signInToCreate('/signin')} disabled={!name.trim()}>
                Sign in to create
              </Button>
              {allowRegistration && (
                <Button variant="primary" icon={<UserPlus size={15} />} onClick={() => signInToCreate('/register')} disabled={!name.trim()}>
                  Create free account
                </Button>
              )}
            </>
          )}
        </>
      }
    >
      {step === 1 && (
        <div className="choice-list">
          {(Object.keys(PROJECT_TYPES) as ProjectType[]).map((t) => (
            <button key={t} type="button" className="choice choice-lg" onClick={() => setType(t)}>
              <span className={`tile tile-${t}`}>
                <Icon name={PROJECT_TYPES[t].icon} size={20} />
              </span>
              <span>
                <strong>{PROJECT_TYPES[t].label}</strong>
                <small>{PROJECT_TYPES[t].blurb}</small>
              </span>
            </button>
          ))}
        </div>
      )}
      {step === 2 && (
        <div className="choice-list">
          {forType.map((t) => (
            <button key={`${t.pluginId}:${t.id}`} type="button" className="choice choice-lg" onClick={() => pickTemplate(t)}>
              <span className={`tile tile-${t.type}`}>
                <Icon name={t.icon} size={20} />
              </span>
              <span>
                <strong>{t.name}</strong>
                <small>{t.description}</small>
                <small className="muted">
                  {t.graph.nodes.length} steps, ready to run after you add your connections
                </small>
              </span>
            </button>
          ))}
          <button type="button" className="choice choice-lg" onClick={() => pickTemplate(null)}>
            <span className="tile">
              <FilePlus2 size={20} />
            </span>
            <span>
              <strong>Blank project</strong>
              <small>Start empty and add steps yourself. Guided mode will walk you through it.</small>
            </span>
          </button>
        </div>
      )}
      {step === 3 && (
        <div className="fields">
          <div className="field">
            <div className="field-label">
              <label>
                Project name<span className="req">*</span>
              </label>
            </div>
            <input
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void create();
              }}
            />
          </div>
          <div className="field">
            <div className="field-label">
              <label>Description</label>
            </div>
            <textarea rows={3} value={description} placeholder="What is this project for? (optional)" onChange={(e) => setDescription(e.target.value)} />
          </div>
          {!signedIn && (
            <div className="hint-box hint-signin">
              <LogIn size={15} />
              <span>
                Projects are saved to your account. Sign in or create a free account, and you come straight back here to create{' '}
                <strong>{name.trim() || 'your project'}</strong>.
              </span>
            </div>
          )}
          <div className="hint-box">
            {template ? (
              <>
                Starting from <strong>{template.name}</strong>. You can change every step afterwards.
              </>
            ) : (
              <>Starting blank. You will choose how the project starts, then add steps.</>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
