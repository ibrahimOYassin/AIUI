import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { tokenStore } from './api';
import { AppRoutes } from './AppRoutes';
import { isGuestPath } from './lib/site';
import { useApp } from './stores/app';
import { ConfirmHost, ErrorBox, Spinner, Toasts } from './components/ui';
import { ConnectionDialogHost } from './components/ConnectionDialog';
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

  // Guests see the pages they may open at once (they are also served as ready-made HTML),
  // so search engines and new visitors never wait for the server or see an error instead of them.
  const guestPage = !user && !tokenStore.get() && isGuestPath(location.pathname);

  let body;
  if (booting && !guestPage) {
    body = (
      <div className="boot">
        <img className="boot-logo" src="/logo.svg" alt="AIUI" />
        <Spinner label="Starting AIUI…" />
      </div>
    );
  } else if (bootError && !guestPage) {
    body = (
      <div className="boot">
        <img className="boot-logo" src="/logo.svg" alt="AIUI" />
        <ErrorBox message={bootError} onRetry={() => void boot()} />
        <p className="muted small">
          Start the server with <code>npm start</code> (or <code>npm run dev</code>) in the project folder.
        </p>
      </div>
    );
  } else {
    body = <AppRoutes />;
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
