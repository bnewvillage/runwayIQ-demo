import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthProvider.jsx';

/** Route guard: waits for auth, then requires a whitelisted user. */
export default function RequireAuth({ children }) {
  const { loading, user, allowed } = useAuth();

  if (loading) {
    return <div className="auth-loading">Checking access&hellip;</div>;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (!allowed) {
    return <Navigate to="/login" state={{ error: 'unauthorized' }} replace />;
  }
  return children;
}
