import { useCallback, useEffect, useState } from 'react';
import { User, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { auth, googleProvider } from '../firebase';

export const ADMIN_EMAIL = 'rajsjarma8@gmail.com';

export function isFirebaseAdminUser(user: User | null): boolean {
  return Boolean(
    user && user.emailVerified && user.email?.toLowerCase() === ADMIN_EMAIL
  );
}

export function useFirebaseAuth() {
  const [user, setUser] = useState<User | null>(() => auth.currentUser);
  const [authReady, setAuthReady] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  const signInWithGoogle = useCallback(async (): Promise<{
    ok: boolean;
    error?: string;
  }> => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
      return { ok: true };
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Google sign-in failed.';
      setAuthError(msg);
      return { ok: false, error: msg };
    } finally {
      setAuthLoading(false);
    }
  }, []);

  const signOutUser = useCallback(async () => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      await signOut(auth);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sign-out failed.';
      setAuthError(msg);
    } finally {
      setAuthLoading(false);
    }
  }, []);

  return {
    user,
    authReady,
    authLoading,
    authError,
    isAdmin: isFirebaseAdminUser(user),
    signInWithGoogle,
    signOutUser,
  };
}
