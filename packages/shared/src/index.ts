/**
 * AIUI shared contract.
 * Every request/response shape exchanged between apps/web and apps/server is defined here.
 * See docs/TECHNICAL_SPEC.md.
 */

// ───────────────────────────── Accounts ─────────────────────────────

export type Role = 'user' | 'developer' | 'admin';

export interface User {
  id: string;
  email: string;
  name: string;
  roles: Role[];
  /** Public name shown on marketplace listings. Set when the user becomes a developer. */
  developerName: string | null;
  createdAt: string;
  /** A disabled account cannot sign in or use the API. */
  status: 'active' | 'disabled';
  /** Whether this person may press Run inside the IDE (platform setting + role). */
  canRun: boolean;
  lastSeenAt: string | null;
}

export interface AuthResponse {
  token: string;
  user: User;
}

/** GET /auth/me. `impersonator` is set while an admin is signed in as this user. */
export interface MeResponse {
  user: User;
  impersonator: { id: string; name: string } | null;
}

/** POST /auth/password */
export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface AppConfig {
  mode: 'local' | 'web';
  /** True when "Run" inside the IDE is enabled for at least some users. Per user: User.canRun. */
  allowRun: boolean;
  /** False when an admin closed sign-ups (web mode). */
  allowRegistration: boolean;
  version: string;
}

// ───────────────────────────── Graph ─────────────────────────────

export type ProjectType = 'workflow' | 'agent' | 'solution';
export type Language = 'python' | 'csharp';

export interface ToolParam {
  name: string;
  type: 'string' | 'number' | 'boolean';
  description: string;
  required?: boolean;
}

export interface FlowNode {
  id: string;
  /** Step type id contributed by a plugin, e.g. "http.request". */
  type: string;
  /** Unique, reference-safe name: lowercase letters, digits, underscore. Used in {{name.field}}. */
  name: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
  onError?: 'stop' | 'continue';
  notes?: string;
  /** Used when this step is linked from an agent's "tools" port. */
  tool?: { description: string; params: ToolParam[] };
}

export interface FlowEdge {
  id: string;
  source: string;
  /** Output port id on the source step: "out", "true", "false", "item", "done", "tools". */
  sourcePort: string;
  target: string;
}

export interface Graph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface ProjectSettings {
  defaultLanguage: Language;
}

export interface ProjectSummary {
  id: string;
  name: string;
  description: string;
  type: ProjectType;
  stepCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Project extends Omit<ProjectSummary, 'stepCount'> {
  graph: Graph;
  settings: ProjectSettings;
}

export interface CreateProjectRequest {
  name: string;
  description?: string;
  type: ProjectType;
  /** Optional template id from the catalog; blank project when omitted. */
  templateId?: string;
}

export interface UpdateProjectRequest {
  name?: string;
  description?: string;
  graph?: Graph;
  settings?: Partial<ProjectSettings>;
}

// ───────────────────────────── Plugins ─────────────────────────────

export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'boolean'
  | 'select'
  | 'secret'
  | 'connection'
  | 'json'
  | 'keyvalue'
  | 'list';

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  default?: unknown;
  placeholder?: string;
  help?: string;
  /** For "select". */
  options?: { value: string; label: string }[];
  /** For "connection": which connection type may be chosen. */
  connectionType?: string;
  /** For "connection": allow choosing several (value is string[]). */
  multiple?: boolean;
  /** Accepts {{references}}; the UI shows the variable picker. */
  templated?: boolean;
  /** Show only when another field has one of these values. */
  showIf?: { field: string; equals: unknown | unknown[] };
  /** "Advanced" puts the field in a collapsed section. */
  group?: string;
  /** Rows for textarea/json. */
  rows?: number;
}

export interface PortDef {
  id: string;
  label: string;
}

export type NodeKind = 'trigger' | 'action' | 'logic' | 'ai';

export interface NodeCodegen {
  python: { source: string; requirements?: string[] };
  csharp: { className: string; source: string; packages?: { name: string; version: string }[] };
}

export interface NodeTypeDef {
  type: string;
  label: string;
  description: string;
  kind: NodeKind;
  category: string;
  /** lucide-react icon name in kebab-case, e.g. "mail". */
  icon: string;
  inputs: PortDef[];
  outputs: PortDef[];
  /** True for steps that expose a "tools" port (AI Agent). */
  toolPort?: boolean;
  fields: FieldDef[];
  /** Keys of the step's output, offered by the variable picker. */
  outputFields?: { key: string; label: string }[];
  codegen: NodeCodegen;
}

export interface ConnectionPreset {
  label: string;
  values: Record<string, unknown>;
}

export interface ConnectionTypeDef {
  type: string;
  label: string;
  description: string;
  icon: string;
  fields: FieldDef[];
  presets?: ConnectionPreset[];
}

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  type: ProjectType;
  icon: string;
  graph: Graph;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  icon: string;
  category: string;
  nodes: NodeTypeDef[];
  connectionTypes?: ConnectionTypeDef[];
  templates?: ProjectTemplate[];
}

// ───────────────────────────── Catalog (what the IDE loads) ─────────────────────────────

/** A step type as the IDE sees it: no source code, plus the plugin it came from. */
export type NodeTypeInfo = Omit<NodeTypeDef, 'codegen'> & { pluginId: string; pluginName: string };
export type ConnectionTypeInfo = ConnectionTypeDef & { pluginId: string };
export type TemplateInfo = ProjectTemplate & { pluginId: string };

export interface InstalledPlugin {
  id: string;
  name: string;
  version: string;
  latestVersion: string;
  description: string;
  icon: string;
  category: string;
  author: string;
  enabled: boolean;
  /** Core plugins cannot be disabled or uninstalled. */
  builtin: boolean;
  nodeCount: number;
}

export interface Catalog {
  nodeTypes: NodeTypeInfo[];
  connectionTypes: ConnectionTypeInfo[];
  templates: TemplateInfo[];
  plugins: InstalledPlugin[];
}

// ───────────────────────────── Connections ─────────────────────────────

export interface Connection {
  id: string;
  name: string;
  type: string;
  /** Non-secret values. Secret fields are never returned. */
  values: Record<string, unknown>;
  /** Keys of secret fields that currently hold a value. */
  secretsSet: string[];
  createdAt: string;
}

export interface SaveConnectionRequest {
  name: string;
  type: string;
  /** Includes secret fields. On update, an omitted or empty secret keeps the stored value. */
  values: Record<string, unknown>;
}

export interface TestConnectionResult {
  ok: boolean;
  message: string;
}

// ───────────────────────────── Build: validate / generate / run ─────────────────────────────

export interface Issue {
  severity: 'error' | 'warning';
  message: string;
  nodeId?: string;
  field?: string;
}

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface GenerateResponse {
  language: Language;
  files: GeneratedFile[];
  issues: Issue[];
}

export interface RunRequest {
  /** Passed to the trigger as {{input}}. For chat: { message, history }. */
  input?: unknown;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** One line of the NDJSON stream returned by POST /projects/:id/run. */
export type RunEvent =
  | { type: 'run_start'; at: string }
  | { type: 'node_start'; nodeId: string; name: string }
  | { type: 'node_end'; nodeId: string; name: string; port: string; output: unknown; ms: number }
  | { type: 'node_error'; nodeId: string; name: string; error: string }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string; nodeId?: string }
  | { type: 'stdout'; text: string }
  | { type: 'run_end'; status: 'success' | 'error' | 'stopped'; error?: string; output?: unknown; ms: number };

// ───────────────────────────── Marketplace ─────────────────────────────

export interface Listing {
  /** Plugin id, e.g. "aiui.email". */
  id: string;
  name: string;
  summary: string;
  category: string;
  icon: string;
  tags: string[];
  author: { id: string; name: string };
  version: string;
  priceCents: number;
  currency: 'USD';
  downloads: number;
  rating: number;
  ratingCount: number;
  status: 'draft' | 'published';
  official: boolean;
  builtin: boolean;
  nodeCount: number;
  updatedAt: string;
  /** For the signed-in user. Free plugins are always owned. */
  owned: boolean;
  installed: boolean;
}

export interface Review {
  userName: string;
  rating: number;
  comment: string;
  createdAt: string;
  mine: boolean;
}

export interface ListingDetail extends Listing {
  description: string;
  nodes: { type: string; label: string; description: string; icon: string; kind: NodeKind }[];
  connectionTypes: { type: string; label: string; icon: string }[];
  templates: { id: string; name: string; description: string }[];
  versions: { version: string; changelog: string; createdAt: string }[];
  reviews: Review[];
}

export interface MarketQuery {
  q?: string;
  category?: string;
  price?: 'free' | 'paid';
  sort?: 'popular' | 'new' | 'rating';
}

// ───────────────────────────── Developer portal ─────────────────────────────

export interface DevListing extends Listing {
  description: string;
  salesCount: number;
  earningsCents: number;
  /** Latest manifest, for editing. */
  manifest: PluginManifest;
}

export interface SaveDevPluginRequest {
  manifest: PluginManifest;
  summary?: string;
  priceCents?: number;
  tags?: string[];
  changelog?: string;
}

export interface ValidateManifestResponse {
  ok: boolean;
  errors: string[];
}

export interface Earnings {
  totalCents: number;
  salesCount: number;
  sales: { pluginId: string; pluginName: string; priceCents: number; developerCents: number; createdAt: string }[];
}

export interface UpdateMeRequest {
  name?: string;
  becomeDeveloper?: boolean;
  developerName?: string;
}

// ───────────────────────────── Administration (role "admin") ─────────────────────────────

/** A user as the admin sees them, with usage counts. */
export interface AdminUser extends User {
  projectCount: number;
  connectionCount: number;
  installedPluginCount: number;
  publishedPluginCount: number;
  runCount: number;
  exportCount: number;
  loginCount: number;
  lastLoginAt: string | null;
}

export interface ActivityEvent {
  id: number;
  at: string;
  /** Who did it. Null for anonymous events such as a failed sign-in. */
  user: { id: string; name: string; email: string } | null;
  /** Set when an admin did this while signed in as the user. */
  impersonator: { id: string; name: string } | null;
  /** Dotted type, e.g. "auth.login", "project.run", "admin.user.disable". */
  type: string;
  /** One readable sentence, e.g. 'Ran project "Orders digest" (success)'. */
  summary: string;
}

export interface AdminUserDetail extends AdminUser {
  projects: ProjectSummary[];
  recentActivity: ActivityEvent[];
}

/** GET /admin/users */
export interface AdminUserQuery {
  q?: string;
  status?: 'active' | 'disabled';
  role?: Role;
}

/** POST /admin/users */
export interface AdminCreateUserRequest {
  email: string;
  name: string;
  password: string;
  roles?: Role[];
}

/** PATCH /admin/users/:id — every field optional. */
export interface AdminUpdateUserRequest {
  name?: string;
  email?: string;
  status?: 'active' | 'disabled';
  roles?: Role[];
  developerName?: string;
}

export interface PlatformSettings {
  /** Whether new people may create an account themselves. */
  allowRegistration: boolean;
  /** Who may press Run inside the IDE. Run executes generated code on the server. */
  runAccess: 'none' | 'admins' | 'all';
}

export interface ReportOverview {
  /** Number of days covered by `series` and the "in period" totals. */
  days: number;
  totals: {
    users: number;
    disabledUsers: number;
    activeToday: number;
    active7d: number;
    active30d: number;
    newUsersInPeriod: number;
    projects: number;
    connections: number;
    runsInPeriod: number;
    failedRunsInPeriod: number;
    exportsInPeriod: number;
    pluginInstalls: number;
    publishedPlugins: number;
    purchases: number;
    revenueCents: number;
  };
  /** One entry per day, oldest first, including days with no activity. */
  series: { day: string; activeUsers: number; signups: number; runs: number; exports: number }[];
  projectsByType: { type: ProjectType; count: number }[];
  exportsByLanguage: { language: Language; count: number }[];
  topPlugins: { id: string; name: string; installs: number }[];
  /** Most active people in the period. */
  topUsers: { id: string; name: string; email: string; activeDays: number; runs: number; exports: number; projects: number }[];
}

/** GET /admin/reports/activity */
export interface ActivityQuery {
  userId?: string;
  /** Type prefix, e.g. "auth", "project", "plugin", "admin". */
  type?: string;
  /** Return events with an id below this one (for "Load more"). */
  before?: number;
  limit?: number;
}

export interface ActivityPage {
  events: ActivityEvent[];
  /** Pass as `before` to get the next page; null when there are no more. */
  nextBefore: number | null;
}

/** A marketplace listing as the admin sees it. */
export interface AdminPlugin extends Listing {
  developerEmail: string;
  salesCount: number;
  revenueCents: number;
}

/** PATCH /admin/plugins/:id */
export interface AdminUpdatePluginRequest {
  status?: 'draft' | 'published';
  official?: boolean;
}

export interface ApiError {
  error: string;
}

// ───────────────────────────── Helpers ─────────────────────────────

/** Turn any label into a reference-safe step name. */
export function slugify(label: string): string {
  const s = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return /^[a-z]/.test(s) ? s : `step_${s}`.replace(/_$/, '');
}

/** Pick a name not already used in the graph: fetch, fetch_2, fetch_3… */
export function uniqueName(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const root = slugify(base) || 'step';
  if (!used.has(root)) return root;
  for (let i = 2; ; i++) {
    const candidate = `${root}_${i}`;
    if (!used.has(candidate)) return candidate;
  }
}

export const RESERVED_NAMES = ['input', 'vars', 'item', 'index', 'args', 'env'];

export function formatPrice(cents: number): string {
  return cents === 0 ? 'Free' : `$${(cents / 100).toFixed(2)}`;
}
