import { create } from 'zustand';
import type { AppConfig, AuthResponse, Catalog, Connection, NodeTypeInfo, User } from '@aiui/shared';
import { ADMIN_USERS_PATH, api, errorMessage, impersonation, isRestoringAdmin, onUnauthorized, tokenStore } from '../api';

export type Theme = 'light' | 'dark';

export interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  message: string;
}

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

export interface ConnectionDialogRequest {
  /** Pre-selected connection type for a new connection. */
  type?: string;
  /** Lock the type (used from a step's connection field). */
  lockType?: boolean;
  /** Existing connection to edit. */
  connection?: Connection;
  resolve: (saved: Connection | null) => void;
}

interface AppState {
  booting: boolean;
  bootError: string | null;
  config: AppConfig | null;
  user: User | null;
  /** The administrator behind this session, while they are signed in as someone else. */
  impersonator: { id: string; name: string } | null;
  catalog: Catalog;
  nodeTypes: Map<string, NodeTypeInfo>;
  connections: Connection[];
  theme: Theme;
  toasts: Toast[];
  confirm: ConfirmRequest | null;
  connectionDialog: ConnectionDialogRequest | null;
  paletteOpen: boolean;

  boot: () => Promise<void>;
  signIn: (auth: AuthResponse) => Promise<void>;
  signOut: () => void;
  setUser: (user: User) => void;
  /** Re-read the platform config and the signed-in user (after settings change). */
  refreshSession: () => Promise<void>;
  /** Continue as another user; the admin's own token is kept aside. Reloads the app. */
  startImpersonation: (userId: string) => Promise<void>;
  /** Go back to the administrator's own session. Reloads the app. */
  stopImpersonation: () => void;
  loadCatalog: () => Promise<void>;
  loadConnections: () => Promise<void>;
  setTheme: (theme: Theme) => void;
  toast: (kind: Toast['kind'], message: string) => void;
  dismissToast: (id: number) => void;
  askConfirm: (req: Omit<ConfirmRequest, 'resolve'>) => Promise<boolean>;
  closeConfirm: (ok: boolean) => void;
  openConnectionDialog: (req?: Omit<ConnectionDialogRequest, 'resolve'>) => Promise<Connection | null>;
  closeConnectionDialog: (saved: Connection | null) => void;
  setPaletteOpen: (open: boolean) => void;
}

function initialTheme(): Theme {
  if (typeof document === 'undefined') return 'light'; // rendering pages at build time
  const current = document.documentElement.dataset.theme;
  return current === 'dark' ? 'dark' : 'light';
}

let toastSeq = 1;

const EMPTY_CATALOG: Catalog = { nodeTypes: [], connectionTypes: [], templates: [], plugins: [] };

/** The built-in steps and templates, written into the ready-made public pages so guests see them at once. */
function embeddedCatalog(): Catalog {
  if (typeof document === 'undefined') return EMPTY_CATALOG;
  try {
    const text = document.getElementById('aiui-catalog')?.textContent;
    const catalog = text ? (JSON.parse(text) as Catalog) : null;
    return catalog?.nodeTypes ? catalog : EMPTY_CATALOG;
  } catch {
    return EMPTY_CATALOG;
  }
}
const INITIAL_CATALOG = embeddedCatalog();

export const useApp = create<AppState>((set, get) => ({
  booting: true,
  bootError: null,
  config: null,
  user: null,
  impersonator: null,
  catalog: INITIAL_CATALOG,
  nodeTypes: new Map(INITIAL_CATALOG.nodeTypes.map((n) => [n.type, n])),
  connections: [],
  theme: initialTheme(),
  toasts: [],
  confirm: null,
  connectionDialog: null,
  paletteOpen: false,

  boot: async () => {
    set({ booting: true, bootError: null });
    try {
      const config = await api.config();
      set({ config });
      let user: User | null = null;
      let impersonator: AppState['impersonator'] = null;
      // An existing session wins, also in local mode: an admin may be signed in as someone else.
      if (tokenStore.get()) {
        try {
          const me = await api.me();
          user = me.user;
          impersonator = me.impersonator;
        } catch {
          user = null;
        }
        // The admin's own session is being restored and the page is reloading: stay on the splash.
        if (isRestoringAdmin()) return;
      }
      if (!user && config.mode === 'local') {
        const auth = await api.localSignIn();
        tokenStore.set(auth.token);
        user = auth.user;
      }
      // A saved admin token without an impersonated session is stale: forget it.
      if (!impersonator && impersonation.active()) impersonation.discard();
      set({ user, impersonator });
      // Guests can look around too: they get the built-in steps and templates.
      await Promise.all([get().loadCatalog(), user ? get().loadConnections() : null]);
      set({ booting: false });
    } catch (err) {
      set({ booting: false, bootError: errorMessage(err) });
    }
  },

  signIn: async (auth) => {
    tokenStore.clearAll();
    tokenStore.set(auth.token);
    set({ user: auth.user, impersonator: null });
    await Promise.all([get().loadCatalog(), get().loadConnections()]);
  },

  signOut: () => {
    tokenStore.clearAll();
    set({ user: null, impersonator: null, catalog: EMPTY_CATALOG, nodeTypes: new Map(), connections: [] });
    void get().loadCatalog();
  },

  setUser: (user) => set({ user }),

  refreshSession: async () => {
    try {
      const [config, me] = await Promise.all([api.config(), api.me()]);
      set({ config, user: me.user, impersonator: me.impersonator });
    } catch {
      /* the next request reports the problem */
    }
  },

  startImpersonation: async (userId) => {
    const auth = await api.adminImpersonate(userId);
    impersonation.begin(auth.token);
    window.location.assign('/');
  },

  stopImpersonation: () => {
    if (impersonation.end()) window.location.assign(ADMIN_USERS_PATH);
    else get().signOut();
  },

  loadCatalog: async () => {
    try {
      const catalog = await api.catalog();
      const safe: Catalog = {
        nodeTypes: catalog?.nodeTypes ?? [],
        connectionTypes: catalog?.connectionTypes ?? [],
        templates: catalog?.templates ?? [],
        plugins: catalog?.plugins ?? [],
      };
      set({ catalog: safe, nodeTypes: new Map(safe.nodeTypes.map((n) => [n.type, n])) });
    } catch (err) {
      get().toast('error', `Could not load the step library: ${errorMessage(err)}`);
    }
  },

  loadConnections: async () => {
    try {
      set({ connections: await api.connections() });
    } catch (err) {
      get().toast('error', `Could not load connections: ${errorMessage(err)}`);
    }
  },

  setTheme: (theme) => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('aiui.theme', theme);
    } catch {
      /* ignore */
    }
    set({ theme });
  },

  toast: (kind, message) => {
    const id = toastSeq++;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, message }] }));
    window.setTimeout(() => get().dismissToast(id), kind === 'error' ? 7000 : 3500);
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  askConfirm: (req) =>
    new Promise<boolean>((resolve) => {
      set({ confirm: { ...req, resolve } });
    }),

  closeConfirm: (ok) => {
    const req = get().confirm;
    set({ confirm: null });
    req?.resolve(ok);
  },

  openConnectionDialog: (req) =>
    new Promise<Connection | null>((resolve) => {
      set({ connectionDialog: { ...(req ?? {}), resolve } });
    }),

  closeConnectionDialog: (saved) => {
    const req = get().connectionDialog;
    set({ connectionDialog: null });
    req?.resolve(saved);
  },

  setPaletteOpen: (open) => set({ paletteOpen: open }),
}));

onUnauthorized(() => {
  const s = useApp.getState();
  if (s.user) s.signOut();
});

export const toast = (kind: Toast['kind'], message: string) => useApp.getState().toast(kind, message);
