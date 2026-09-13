import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider.jsx';
import { ALLOWED_EMAILS } from '../firebase.js';

export default function Login() {
  const { user, allowed, signIn, signOutUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState(location.state?.error === 'unauthorized');

  useEffect(() => {
    if (user && allowed) navigate('/', { replace: true });
  }, [user, allowed, navigate]);

  async function handleSignIn() {
    try {
      const result = await signIn();
      if (!ALLOWED_EMAILS.includes(result.user.email)) {
        await signOutUser();
        setError(true);
      }
    } catch (err) {
      console.error('Sign in error:', err);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 17l6-8 4 5 8-10" />
          </svg>
        </div>
        <div className="login-title">RUNWAY IQ</div>
        <div className="login-sub">
          Purchasing &amp; demand forecasting.<br />
          Public demo — every figure inside is generated, not real.
        </div>

        {/* The real build signs in with Google against a Firebase project
            and hands the token to a backend that verifies it. There is no
            project and no backend here, so this enters a local session.
            The step is kept because it is part of the shape of the
            product -- see src/firebase.js. */}
        <button className="btn-google" onClick={handleSignIn}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
               strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
          Enter the demo
        </button>

        {error && <div className="error-msg">Your account is not authorised to access this tool.</div>}
        <div className="login-footer">
          No account, no data collected. Sample data only.
        </div>
      </div>
    </div>
  );
}
