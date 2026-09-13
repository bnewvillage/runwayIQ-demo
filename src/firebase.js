// =========================================================
// AUTH -- DEMO BUILD.
//
// The real app signs in with Firebase Google auth and sends the ID token
// to a FastAPI backend that verifies it per request. None of that can
// exist here: there is no backend, no project, and no account to let
// anyone into.
//
// So this file keeps the module's shape -- the same exports, so
// AuthProvider and Login import it unchanged -- and stands in a local
// session instead. Nothing is transmitted, nothing is verified, and
// there is nothing behind it to protect: the "data" is generated in the
// browser by demo/world.js.
//
// The sign-in step is kept rather than removed on purpose. It is part of
// what the product is, and a demo that drops straight onto the dashboard
// misrepresents the shape of the thing.
// =========================================================

const KEY = 'runway-demo-session';

export const DEMO_USER = {
  email: 'demo@runwayiq.example',
  displayName: 'Demo User',
  uid: 'demo',
};

/** In the real build this is a UX gate only -- the actual boundary is the
 *  backend verifying the token. Here it is neither: it exists so the
 *  Login page's "not authorised" branch still has something to test
 *  against, and the demo user is always on the list. */
export const ALLOWED_EMAILS = [DEMO_USER.email];

export const auth = {
  get currentUser() {
    try {
      return sessionStorage.getItem(KEY) ? DEMO_USER : null;
    } catch {
      // Private windows and blocked site data both throw here rather
      // than returning empty, so the read has to be guarded.
      return null;
    }
  },
};

const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn(auth.currentUser));

export function onDemoAuthChanged(fn) {
  listeners.add(fn);
  fn(auth.currentUser);
  return () => listeners.delete(fn);
}

export function demoSignIn() {
  try { sessionStorage.setItem(KEY, '1'); } catch { /* nothing to persist to */ }
  emit();
  return Promise.resolve({ user: DEMO_USER });
}

export function demoSignOut() {
  try { sessionStorage.removeItem(KEY); } catch { /* already gone */ }
  emit();
  return Promise.resolve();
}

// Named for parity with the real module, which hands Login a provider to
// pass to signInWithPopup. Nothing here uses it.
export const googleProvider = { providerId: 'demo' };
export const app = { name: 'runway-iq-demo' };
