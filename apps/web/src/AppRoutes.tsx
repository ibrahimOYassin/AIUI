import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useApp } from './stores/app';
import { Shell } from './components/Shell';
import { ErrorBox } from './components/ui';
import { AuthPage } from './pages/Auth';
import { HomePage } from './pages/Home';
import { ConnectionsPage } from './pages/Connections';
import { MarketplacePage } from './pages/Marketplace';
import { ListingPage } from './pages/Listing';
import { DeveloperPage } from './pages/Developer';
import { PluginEditorPage } from './pages/PluginEditor';
import { AccountPage } from './pages/Account';
import { DocsPage } from './pages/Docs';
import { IdePage } from './ide/IdePage';
import { AdminPage } from './pages/admin/AdminPage';
import { AdminUserPage } from './pages/admin/UserDetail';

/**
 * Every page of the app. Guests can open Home, the Marketplace and the Docs without an account;
 * they are asked to sign in when they create a project or open a page that belongs to an account.
 * Also rendered to HTML at build time for search engines (src/prerender.tsx).
 */
export function AppRoutes() {
  const user = useApp((s) => s.user);
  const location = useLocation();
  const signInFirst = <Navigate to="/signin" replace state={{ from: location.pathname + location.search }} />;
  // Once signed in, carry on where the visitor was heading (e.g. back to the project they were creating).
  const from = (location.state as { from?: string } | null)?.from;
  const afterSignIn = <Navigate to={from && !from.startsWith('/signin') && !from.startsWith('/register') ? from : '/'} replace />;
  return (
    <Routes>
      <Route path="/signin" element={user ? afterSignIn : <AuthPage mode="signin" />} />
      <Route path="/register" element={user ? afterSignIn : <AuthPage mode="register" />} />
      <Route element={<Shell />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/marketplace" element={<MarketplacePage tab="browse" />} />
        <Route path="/marketplace/plugin/:id" element={<ListingPage />} />
        <Route path="/docs" element={<DocsPage />} />
        {user ? (
          <>
            <Route path="/projects/:id" element={<IdePage />} />
            <Route path="/connections" element={<ConnectionsPage />} />
            <Route path="/marketplace/installed" element={<MarketplacePage tab="installed" />} />
            <Route path="/developer" element={<DeveloperPage />} />
            <Route path="/developer/new" element={<PluginEditorPage />} />
            <Route path="/developer/edit/:id" element={<PluginEditorPage />} />
            <Route path="/account" element={<AccountPage />} />
            <Route path="/admin" element={<AdminPage tab="reports" />} />
            <Route path="/admin/reports" element={<Navigate to="/admin" replace />} />
            <Route path="/admin/users" element={<AdminPage tab="users" />} />
            <Route path="/admin/users/:id" element={<AdminUserPage />} />
            <Route path="/admin/plugins" element={<AdminPage tab="plugins" />} />
            <Route path="/admin/assistant" element={<AdminPage tab="assistant" />} />
            <Route path="/admin/settings" element={<AdminPage tab="settings" />} />
            <Route path="*" element={<NotFound />} />
          </>
        ) : (
          <Route path="*" element={signInFirst} />
        )}
      </Route>
    </Routes>
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
