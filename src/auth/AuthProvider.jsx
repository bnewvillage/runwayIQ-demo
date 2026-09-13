import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { onDemoAuthChanged, demoSignIn, demoSignOut, ALLOWED_EMAILS } from '../firebase.js';

const AuthContext = createContext(null);

/** Demo build: the same context the real provider exposes, backed by a
 *  local session instead of Firebase. Keeping the interface identical is
 *  what lets every page below stay the shipped one -- see firebase.js on
 *  why the sign-in step is kept at all. */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => onDemoAuthChanged((u) => {
    setUser(u);
    setLoading(false);
  }), []);

  const value = useMemo(() => {
    const allowed = !!user && ALLOWED_EMAILS.includes(user.email);
    return {
      user,
      loading,
      allowed,
      signIn: demoSignIn,
      signOutUser: demoSignOut,
      // No token to fetch: nothing here is verified anywhere. Kept so a
      // call site that asks for one gets a resolved promise rather than
      // a crash.
      getIdToken: () => Promise.resolve(null),
    };
  }, [user, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
