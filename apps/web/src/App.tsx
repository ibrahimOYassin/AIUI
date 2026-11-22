import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useApp } from './stores/app';
import { Shell } from './components/Shell';
import { ConfirmHost, ErrorBox, Spinner, Toasts } from './components/ui';
import { ConnectionDialogHost } from './components/ConnectionDialog';
import { AuthPage } from './pages/Auth';
import { HomePage } from './pages/Home';
import { ConnectionsPage } from './pages/Connections';
import { MarketplacePage } from './pages/Marketplace';
import { ListingPage } from './pages/Listing';
import { DeveloperPage } from './pages/Developer';
import { PluginEditorPage } from './pages/PluginEditor';
import { AccountPage } from './pages/Account';
import { IdePage } from './ide/IdePage';
import { AdminPage } from './pages/admin/AdminPage';
import { AdminUserPage } from './pages/admin/UserDetail';
import { ImpersonationBar } from './components/ImpersonationBar';

export function App() {
  const booting = useApp((s) => s.booting);
  const bootError = useApp((s) => s.bootError);
  const user = useApp((s) => s.user);
  const boot = useApp((s) => s.boot);
  const location = useLocation();

  useEffect(() => {
    void boot();
  }, [boot]);

  let body;
  if (booting) {
    body = (
      <div className="boot">
        <img className="boot-logo" src="/logo.svg" alt="AIUI" />
        <Spinner label="Starting AIUI…" />
      </div>
    );
  } else if (bootError) {
    body = (
      <div className="boot">
        <img className="boot-logo" src="/logo.svg" alt="AIUI" />
        <ErrorBox message={bootError} onRetry={() => void boot()} />
        <p className="muted small">
          Start the server with <code>npm start</code> (or <code>npm run dev</code>) in the project folder.
        </p>
      </div>
    );
  } else if (!user) {
    body = (
      <Routes>
        <Route path="/signin" element={<AuthPage mode="signin" />} />
        <Route path="/register" element={<AuthPage mode="register" />} />
        <Route path="*" element={<Navigate to="/signin" replace state={{ from: location.pathname }} />} />
      </Routes>
    );
  } else {
    body = (
      <Routes>
        <Route element={<Shell />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/projects/:id" element={<IdePage />} />
          <Route path="/connections" element={<ConnectionsPage />} />
          <Route path="/marketplace" element={<MarketplacePage tab="browse" />} />
          <Route path="/marketplace/installed" element={<MarketplacePage tab="installed" />} />
          <Route path="/marketplace/plugin/:id" element={<ListingPage />} />
          <Route path="/developer" element={<DeveloperPage />} />
          <Route path="/developer/new" element={<PluginEditorPage />} />
          <Route path="/developer/edit/:id" element={<PluginEditorPage />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/admin" element={<AdminPage tab="reports" />} />
          <Route path="/admin/reports" element={<Navigate to="/admin" replace />} />
          <Route path="/admin/users" element={<AdminPage tab="users" />} />
          <Route path="/admin/users/:id" element={<AdminUserPage />} />
          <Route path="/admin/plugins" element={<AdminPage tab="plugins" />} />
          <Route path="/admin/settings" element={<AdminPage tab="settings" />} />
          <Route path="/signin" element={<Navigate to="/" replace />} />
          <Route path="/register" element={<Navigate to="/" replace />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    );
  }

  return (
    <>
      <div className="app-frame">
        {user && <ImpersonationBar />}
        <div className="app-body">{body}</div>
      </div>
      {user && <ConnectionDialogHost />}
      <ConfirmHost />
      <Toasts />
    </>
  );
}

function NotFound() {
  return (
    <div className="page">
      <ErrorBox message="That page does not exist." />
      <p>
        <a href="/">Back to Home</a>
      </p>
    </div>
  );
}
