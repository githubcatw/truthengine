import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { api } from './api';
import { auth } from './firebase';
import type { Language, Role } from '../../shared/schemas';

export interface Profile {
  uid: string;
  email: string | null;
  displayName: string | null;
  role: Role;
  preferredLanguage: Language;
  gradeLevel: number | null;
}

interface AuthState {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  profileError: string | null;
  refreshProfile: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string, language: Language) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(Boolean(auth));
  const [profileError, setProfileError] = useState<string | null>(null);

  const refreshProfile = useCallback(async () => {
    try {
      setProfile(await api<Profile>('GET', '/me'));
      setProfileError(null);
    } catch (e) {
      setProfileError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) await refreshProfile();
      else setProfile(null);
      setLoading(false);
    });
  }, [refreshProfile]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      profile,
      loading,
      profileError,
      refreshProfile,
      login: async (email, password) => {
        await signInWithEmailAndPassword(auth!, email, password);
      },
      register: async (name, email, password, language) => {
        const cred = await createUserWithEmailAndPassword(auth!, email, password);
        await updateProfile(cred.user, { displayName: name });
        // Keep the interface language the student chose before registering.
        await api('PATCH', '/me', { displayName: name, preferredLanguage: language });
        await refreshProfile();
      },
      loginWithGoogle: async () => {
        await signInWithPopup(auth!, new GoogleAuthProvider());
      },
      resetPassword: async (email) => {
        await sendPasswordResetEmail(auth!, email);
      },
      logout: async () => {
        await signOut(auth!);
      },
    }),
    [user, profile, loading, profileError, refreshProfile],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
