import { useEffect, useState } from 'react';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import { OdooUser } from './types';
import { LogoMark } from './components/Icons';

export default function App() {
  const [user, setUser] = useState<OdooUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    window.api
      .restoreSession()
      .then(setUser)
      .finally(() => setCheckingSession(false));
  }, []);

  if (checkingSession) {
    return (
      <div className="splash">
        <div className="splash-inner">
          <LogoMark size={40} />
          <div className="spinner" />
          <span>Restaurando sesión...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Login onLoggedIn={setUser} />;
  }

  return <Dashboard user={user} onLoggedOut={() => setUser(null)} />;
}
