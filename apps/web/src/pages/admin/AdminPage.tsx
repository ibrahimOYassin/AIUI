import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { EmptyState, PageHeader, Tabs } from '../../components/ui';
import { useApp } from '../../stores/app';
import { AssistantTab } from './AssistantTab';
import { PluginsTab } from './PluginsTab';
import { ReportsTab } from './ReportsTab';
import { SettingsTab } from './SettingsTab';
import { UsersTab } from './UsersTab';

export type AdminTab = 'reports' | 'users' | 'plugins' | 'assistant' | 'settings';

const PATHS: Record<AdminTab, string> = {
  reports: '/admin',
  users: '/admin/users',
  plugins: '/admin/plugins',
  assistant: '/admin/assistant',
  settings: '/admin/settings',
};

/** Renders its children only for administrators. */
export function AdminOnly({ children }: { children: ReactNode }) {
  const isAdmin = useApp((s) => !!s.user?.roles.includes('admin'));
  if (isAdmin) return <>{children}</>;
  return (
    <div className="page">
      <div className="card">
        <EmptyState
          icon={<ShieldAlert size={24} />}
          title="Administrators only"
          action={
            <Link to="/" className="btn btn-primary btn-md">
              <span>Back to Home</span>
            </Link>
          }
        >
          This area is for people who manage the platform. If you need access, ask an administrator to give your account the Admin role.
        </EmptyState>
      </div>
    </div>
  );
}

export function AdminPage({ tab }: { tab: AdminTab }) {
  const navigate = useNavigate();
  return (
    <AdminOnly>
      <div className="page page-wide">
        <PageHeader title="Administration" subtitle="See who is using the platform, manage accounts and plugins, and control what people may do." />
        <Tabs<AdminTab>
          tabs={[
            { id: 'reports', label: 'Reports' },
            { id: 'users', label: 'Users' },
            { id: 'plugins', label: 'Plugins' },
            { id: 'assistant', label: 'Assistant' },
            { id: 'settings', label: 'Settings' },
          ]}
          value={tab}
          onChange={(id) => navigate(PATHS[id])}
        />
        {tab === 'reports' && <ReportsTab />}
        {tab === 'users' && <UsersTab />}
        {tab === 'plugins' && <PluginsTab />}
        {tab === 'assistant' && <AssistantTab />}
        {tab === 'settings' && <SettingsTab />}
      </div>
    </AdminOnly>
  );
}
