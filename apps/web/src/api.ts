import type {
  ActivityPage,
  ActivityQuery,
  AdminCreateUserRequest,
  AdminPlugin,
  AdminUpdatePluginRequest,
  AdminUpdateUserRequest,
  AdminUser,
  AdminUserDetail,
  AdminUserQuery,
  AppConfig,
  AuthResponse,
  Catalog,
  ChangePasswordRequest,
  Connection,
  CreateProjectRequest,
  DevListing,
  Earnings,
  GenerateResponse,
  InstalledPlugin,
  Issue,
  Language,
  Listing,
  ListingDetail,
  MarketQuery,
  MeResponse,
  PlatformSettings,
  PluginManifest,
  Project,
  ProjectSummary,
  ReportOverview,
  RunEvent,
  RunRequest,
  SaveConnectionRequest,
  SaveDevPluginRequest,
  TestConnectionResult,
  UpdateMeRequest,
  UpdateProjectRequest,
  User,
  ValidateManifestResponse,
} from '@aiui/shared';

const TOKEN_KEY = 'aiui.token';
/** The administrator's own token, kept while they are signed in as someone else. */
const ADMIN_TOKEN_KEY = 'aiui.adminToken';

function readKey(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeKey(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

export const impersonation = {
  active(): boolean {
    return readKey(ADMIN_TOKEN_KEY) !== null;
  },
  /** Keep the admin's token aside and continue as the other user. */
  begin(userToken: string) {
    const current = readKey(TOKEN_KEY);
    if (current && !readKey(ADMIN_TOKEN_KEY)) writeKey(ADMIN_TOKEN_KEY, current);
    writeKey(TOKEN_KEY, userToken);
  },
  /** Forget a saved admin token without switching to it. */
  discard() {
    writeKey(ADMIN_TOKEN_KEY, null);
  },
  /** Put the admin's token back. Returns false when there was none to restore. */
  end(): boolean {
    const admin = readKey(ADMIN_TOKEN_KEY);
    if (!admin) return false;
    writeKey(TOKEN_KEY, admin);
    writeKey(ADMIN_TOKEN_KEY, null);
    return true;
  },
};

export const ADMIN_USERS_PATH = '/admin/users';

export const tokenStore = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string) {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* storage unavailable */
    }
  },
  clear() {
    writeKey(TOKEN_KEY, null);
  },
  /** Sign out completely, including a saved administrator token. */
  clearAll() {
    writeKey(TOKEN_KEY, null);
    writeKey(ADMIN_TOKEN_KEY, null);
  },
};

export class ApiFailure extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let unauthorizedHandler: (() => void) | null = null;
export function onUnauthorized(handler: () => void) {
  unauthorizedHandler = handler;
}

function authHeaders(json: boolean): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

async function failureFrom(res: Response): Promise<ApiFailure> {
  let message = `Request failed (${res.status})`;
  try {
    const body = (await res.json()) as { error?: string };
    if (body && typeof body.error === 'string') message = body.error;
  } catch {
    /* not JSON */
  }
  return new ApiFailure(res.status, message);
}

/** Set once the admin's own session is being restored; the page is about to reload. */
let restoringAdmin = false;
export const isRestoringAdmin = () => restoringAdmin;

async function send(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<Response> {
  const sentWith = tokenStore.get();
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: authHeaders(body !== undefined),
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiFailure(0, 'Cannot reach the AIUI server. Check that it is running, then try again.');
  }
  // A 401 only says something about the token this request was sent with. Requests still in
  // flight when the session changed (several run in parallel) must not sign the new one out.
  const stale = restoringAdmin || tokenStore.get() !== sentWith;
  if (res.status === 401 && path !== '/auth/login' && path !== '/auth/register' && !stale) {
    if (impersonation.end()) {
      restoringAdmin = true;
      // The borrowed session ended (it lasts an hour): go back to the admin's own session.
      window.location.assign(ADMIN_USERS_PATH);
    } else {
      tokenStore.clear();
      unauthorizedHandler?.();
    }
  }
  if (!res.ok) throw await failureFrom(res);
  return res;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await send(method, path, body);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Accept either a bare array or an object wrapping one array. */
function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) if (Array.isArray(v)) return v as T[];
  }
  return [];
}

/** Accept either the object itself or `{ key: object }`. */
function unwrap<T>(value: unknown, key: string): T {
  if (value && typeof value === 'object' && key in value) {
    const inner = (value as Record<string, unknown>)[key];
    if (inner && typeof inner === 'object') return inner as T;
  }
  return value as T;
}

function qs(params: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}

const enc = encodeURIComponent;

export const api = {
  config: () => request<AppConfig>('GET', '/config'),

  // auth
  register: (email: string, name: string, password: string) =>
    request<AuthResponse>('POST', '/auth/register', { email, name, password }),
  login: (email: string, password: string) => request<AuthResponse>('POST', '/auth/login', { email, password }),
  localSignIn: () => request<AuthResponse>('POST', '/auth/local'),
  me: async (): Promise<MeResponse> => {
    const res = await request<Partial<MeResponse> & Partial<User>>('GET', '/auth/me');
    if (res && 'user' in res && res.user) return { user: res.user, impersonator: res.impersonator ?? null };
    return { user: res as User, impersonator: null };
  },
  changePassword: (body: ChangePasswordRequest) => request<unknown>('POST', '/auth/password', body),
  updateMe: async (body: UpdateMeRequest) => unwrap<User>(await request<unknown>('PATCH', '/auth/me', body), 'user'),

  catalog: () => request<Catalog>('GET', '/catalog'),

  // projects
  projects: async () => asArray<ProjectSummary>(await request<unknown>('GET', '/projects')),
  createProject: async (body: CreateProjectRequest) =>
    unwrap<Project>(await request<unknown>('POST', '/projects', body), 'project'),
  project: async (id: string) => unwrap<Project>(await request<unknown>('GET', `/projects/${enc(id)}`), 'project'),
  updateProject: async (id: string, body: UpdateProjectRequest) =>
    unwrap<Project>(await request<unknown>('PUT', `/projects/${enc(id)}`, body), 'project'),
  deleteProject: (id: string) => request<unknown>('DELETE', `/projects/${enc(id)}`),
  duplicateProject: async (id: string) =>
    unwrap<Project>(await request<unknown>('POST', `/projects/${enc(id)}/duplicate`), 'project'),

  // build
  validate: async (id: string) => {
    const res = await request<{ issues?: Issue[] }>('POST', `/projects/${enc(id)}/validate`);
    return res?.issues ?? [];
  },
  generate: (id: string, language: Language) =>
    request<GenerateResponse>('POST', `/projects/${enc(id)}/generate`, { language }),
  exportZip: async (id: string, language: Language): Promise<Blob> => {
    const res = await send('GET', `/projects/${enc(id)}/export${qs({ language })}`);
    return res.blob();
  },

  // connections
  connections: async () => asArray<Connection>(await request<unknown>('GET', '/connections')),
  createConnection: async (body: SaveConnectionRequest) =>
    unwrap<Connection>(await request<unknown>('POST', '/connections', body), 'connection'),
  updateConnection: async (id: string, body: SaveConnectionRequest) =>
    unwrap<Connection>(await request<unknown>('PUT', `/connections/${enc(id)}`, body), 'connection'),
  deleteConnection: (id: string) => request<unknown>('DELETE', `/connections/${enc(id)}`),
  testConnection: (id: string) => request<TestConnectionResult>('POST', `/connections/${enc(id)}/test`),

  // marketplace
  listings: async (query: MarketQuery) =>
    asArray<Listing>(
      await request<unknown>(
        'GET',
        `/market/plugins${qs({ q: query.q, category: query.category, price: query.price, sort: query.sort })}`,
      ),
    ),
  listing: async (id: string) =>
    unwrap<ListingDetail>(await request<unknown>('GET', `/market/plugins/${enc(id)}`), 'listing'),
  purchase: (id: string) => request<unknown>('POST', `/market/plugins/${enc(id)}/purchase`),
  install: (id: string) => request<unknown>('POST', `/market/plugins/${enc(id)}/install`),
  uninstall: (id: string) => request<unknown>('DELETE', `/market/plugins/${enc(id)}/install`),
  review: (id: string, rating: number, comment: string) =>
    request<unknown>('POST', `/market/plugins/${enc(id)}/reviews`, { rating, comment }),
  installed: async () => asArray<InstalledPlugin>(await request<unknown>('GET', '/market/installed')),
  setEnabled: (id: string, enabled: boolean) =>
    request<unknown>('PATCH', `/market/installed/${enc(id)}`, { enabled }),

  // developer
  devPlugins: async () => asArray<DevListing>(await request<unknown>('GET', '/dev/plugins')),
  devCreate: async (body: SaveDevPluginRequest) =>
    unwrap<DevListing>(await request<unknown>('POST', '/dev/plugins', body), 'plugin'),
  devUpdate: async (id: string, body: SaveDevPluginRequest) =>
    unwrap<DevListing>(await request<unknown>('PUT', `/dev/plugins/${enc(id)}`, body), 'plugin'),
  devDelete: (id: string) => request<unknown>('DELETE', `/dev/plugins/${enc(id)}`),
  devPublish: (id: string) => request<unknown>('POST', `/dev/plugins/${enc(id)}/publish`),
  devUnpublish: (id: string) => request<unknown>('POST', `/dev/plugins/${enc(id)}/unpublish`),
  devValidate: (manifest: PluginManifest) =>
    request<ValidateManifestResponse>('POST', '/dev/validate', { manifest }),
  devEarnings: () => request<Earnings>('GET', '/dev/earnings'),

  // administration
  adminUsers: async (query: AdminUserQuery = {}) =>
    asArray<AdminUser>(await request<unknown>('GET', `/admin/users${qs({ q: query.q, status: query.status, role: query.role })}`)),
  adminCreateUser: (body: AdminCreateUserRequest) => request<AdminUser>('POST', '/admin/users', body),
  adminUser: (id: string) => request<AdminUserDetail>('GET', `/admin/users/${enc(id)}`),
  adminUpdateUser: (id: string, body: AdminUpdateUserRequest) => request<AdminUser>('PATCH', `/admin/users/${enc(id)}`, body),
  adminSetPassword: (id: string, password: string) => request<unknown>('POST', `/admin/users/${enc(id)}/password`, { password }),
  adminImpersonate: (id: string) => request<AuthResponse>('POST', `/admin/users/${enc(id)}/impersonate`),
  adminDeleteUser: (id: string) => request<unknown>('DELETE', `/admin/users/${enc(id)}`),
  adminOverview: (days: number) => request<ReportOverview>('GET', `/admin/reports/overview${qs({ days: String(days) })}`),
  adminActivity: async (query: ActivityQuery): Promise<ActivityPage> => {
    const res = await request<Partial<ActivityPage>>(
      'GET',
      `/admin/reports/activity${qs({
        userId: query.userId,
        type: query.type,
        before: query.before !== undefined ? String(query.before) : undefined,
        limit: query.limit !== undefined ? String(query.limit) : undefined,
      })}`,
    );
    return { events: res?.events ?? [], nextBefore: res?.nextBefore ?? null };
  },
  adminPlugins: async () => asArray<AdminPlugin>(await request<unknown>('GET', '/admin/plugins')),
  adminUpdatePlugin: (id: string, body: AdminUpdatePluginRequest) => request<AdminPlugin>('PATCH', `/admin/plugins/${enc(id)}`, body),
  adminDeletePlugin: (id: string) => request<unknown>('DELETE', `/admin/plugins/${enc(id)}`),
  adminSettings: () => request<PlatformSettings>('GET', '/admin/settings'),
  adminSaveSettings: (body: Partial<PlatformSettings>) => request<PlatformSettings>('PUT', '/admin/settings', body),
};

/** Run a saved project and yield its events as they arrive. Abort the signal to stop. */
export async function* streamRun(
  projectId: string,
  body: RunRequest,
  signal: AbortSignal,
): AsyncGenerator<RunEvent, void, void> {
  const res = await send('POST', `/projects/${enc(projectId)}/run`, body, signal);
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const parse = (line: string): RunEvent | null => {
    const trimmed = line.trim();
    if (!trimmed) return null;
    try {
      const value = JSON.parse(trimmed) as RunEvent;
      if (value && typeof value === 'object' && 'type' in value) return value;
    } catch {
      /* fall through */
    }
    return { type: 'stdout', text: trimmed };
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl = buffer.indexOf('\n');
    while (nl >= 0) {
      const event = parse(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
      if (event) yield event;
      nl = buffer.indexOf('\n');
    }
  }
  const last = parse(buffer);
  if (last) yield last;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
