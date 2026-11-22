import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Code2, Home, Moon, Plug, Search, ShieldCheck, Store, Sun, UserRound } from 'lucide-react';
import { Icon } from '../lib/icons';
import { isTrigger } from '../lib/graph';
import { useApp } from '../stores/app';
import { useEditor } from '../stores/editor';

const NAV = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/connections', label: 'Connections', icon: Plug, end: false },
  { to: '/marketplace', label: 'Marketplace', icon: Store, end: false },
  { to: '/developer', label: 'Developer', icon: Code2, end: false },
];

export function Shell() {
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);
  const setPaletteOpen = useApp((s) => s.setPaletteOpen);
  const paletteOpen = useApp((s) => s.paletteOpen);
  const user = useApp((s) => s.user);
  const isAdmin = !!user?.roles.includes('admin');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(!useApp.getState().paletteOpen);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setPaletteOpen]);

  return (
    <div className="shell">
      <nav className="rail" aria-label="Main">
        <NavLink to="/" className="rail-logo" title="AIUI">
          <span>A</span>
        </NavLink>
        {NAV.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `rail-item ${isActive ? 'active' : ''}`} title={item.label}>
            <item.icon size={19} />
            <span>{item.label}</span>
          </NavLink>
        ))}
        {isAdmin && (
          <NavLink to="/admin" className={({ isActive }) => `rail-item ${isActive ? 'active' : ''}`} title="Administration">
            <ShieldCheck size={19} />
            <span>Admin</span>
          </NavLink>
        )}
        <span className="grow" />
        <button type="button" className="rail-item" onClick={() => setPaletteOpen(true)} title="Search and commands (Ctrl+K)">
          <Search size={19} />
          <span>Search</span>
        </button>
        <button
          type="button"
          className="rail-item"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
          <span>Theme</span>
        </button>
        <NavLink to="/account" className={({ isActive }) => `rail-item ${isActive ? 'active' : ''}`} title={user?.name ?? 'Account'}>
          <UserRound size={19} />
          <span>Account</span>
        </NavLink>
      </nav>
      <main className="shell-main">
        <Outlet />
      </main>
      {paletteOpen && <CommandPalette />}
    </div>
  );
}

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: string;
  run: () => void;
}

function CommandPalette() {
  const navigate = useNavigate();
  const location = useLocation();
  const close = () => useApp.getState().setPaletteOpen(false);
  const theme = useApp((s) => s.theme);
  const nodeTypes = useApp((s) => s.catalog.nodeTypes);
  const isAdmin = useApp((s) => !!s.user?.roles.includes('admin'));
  const project = useEditor((s) => s.project);
  const [q, setQ] = useState('');
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inIde = !!project && location.pathname.startsWith('/projects/');

  const commands = useMemo<Command[]>(() => {
    const go = (to: string) => () => navigate(to);
    const list: Command[] = [
      { id: 'new', label: 'New project', hint: 'Create', icon: 'plus', run: go('/?new=1') },
      { id: 'home', label: 'Go to Home', hint: 'Navigate', icon: 'home', run: go('/') },
      { id: 'conn', label: 'Go to Connections', hint: 'Navigate', icon: 'plug', run: go('/connections') },
      { id: 'market', label: 'Go to Marketplace', hint: 'Navigate', icon: 'store', run: go('/marketplace') },
      { id: 'plugins', label: 'Go to My plugins', hint: 'Navigate', icon: 'puzzle', run: go('/marketplace/installed') },
      { id: 'dev', label: 'Go to Developer portal', hint: 'Navigate', icon: 'code-2', run: go('/developer') },
      { id: 'account', label: 'Go to Account', hint: 'Navigate', icon: 'user-round', run: go('/account') },
      {
        id: 'theme',
        label: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
        hint: 'Appearance',
        icon: theme === 'dark' ? 'sun' : 'moon',
        run: () => useApp.getState().setTheme(theme === 'dark' ? 'light' : 'dark'),
      },
      {
        id: 'new-conn',
        label: 'New connection',
        hint: 'Create',
        icon: 'plug-zap',
        run: () => void useApp.getState().openConnectionDialog(),
      },
    ];
    if (isAdmin) {
      list.push(
        { id: 'admin-reports', label: 'Admin: Reports and activity', hint: 'Admin', icon: 'chart-line', run: go('/admin') },
        { id: 'admin-users', label: 'Admin: Users', hint: 'Admin', icon: 'users', run: go('/admin/users') },
        { id: 'admin-plugins', label: 'Admin: Plugins', hint: 'Admin', icon: 'puzzle', run: go('/admin/plugins') },
        { id: 'admin-settings', label: 'Admin: Settings', hint: 'Admin', icon: 'settings', run: go('/admin/settings') },
      );
    }
    if (inIde) {
      const ed = useEditor.getState();
      list.unshift(
        { id: 'mode-guided', label: 'Switch to Guided mode', hint: 'IDE', icon: 'list-ordered', run: () => ed.setMode('guided') },
        { id: 'mode-canvas', label: 'Switch to Canvas mode', hint: 'IDE', icon: 'workflow', run: () => ed.setMode('canvas') },
        { id: 'mode-code', label: 'Switch to Code mode', hint: 'IDE', icon: 'code', run: () => ed.setMode('code') },
      );
      const hasTrigger = ed.graph.nodes.some((n) => isTrigger(useApp.getState().nodeTypes.get(n.type)));
      for (const def of nodeTypes) {
        if (isTrigger(def) && hasTrigger) continue;
        list.push({
          id: `add:${def.type}`,
          label: `Add step: ${def.label}`,
          hint: def.category,
          icon: def.icon,
          run: () => {
            const state = useEditor.getState();
            if (state.mode === 'code') state.setMode('canvas');
            state.addStep(def);
          },
        });
      }
    }
    return list;
  }, [navigate, theme, nodeTypes, inIde, isAdmin]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return commands;
    const words = needle.split(/\s+/);
    return commands.filter((c) => words.every((w) => `${c.label} ${c.hint ?? ''}`.toLowerCase().includes(w)));
  }, [commands, q]);

  useEffect(() => setIndex(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector('.palette-item.active')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const run = (cmd: Command | undefined) => {
    if (!cmd) return;
    close();
    cmd.run();
  };

  return createPortal(
    <div
      className="modal-backdrop palette-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="palette" role="dialog" aria-label="Command palette">
        <div className="palette-input">
          <Search size={16} />
          <input
            autoFocus
            placeholder={inIde ? 'Add a step, switch mode, or go somewhere…' : 'Type a command or search…'}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIndex((i) => Math.min(filtered.length - 1, i + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIndex((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                run(filtered[index]);
              } else if (e.key === 'Escape') {
                close();
              }
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-list" ref={listRef}>
          {filtered.length === 0 && <div className="palette-empty">No matching commands.</div>}
          {filtered.map((c, i) => (
            <button
              key={c.id}
              type="button"
              className={`palette-item ${i === index ? 'active' : ''}`}
              onMouseEnter={() => setIndex(i)}
              onClick={() => run(c)}
            >
              <Icon name={c.icon} size={15} />
              <span>{c.label}</span>
              {c.hint && <small>{c.hint}</small>}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
