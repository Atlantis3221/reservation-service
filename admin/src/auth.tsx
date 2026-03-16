import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { api, type Business } from './api';

interface AuthState {
  token: string | null;
  user: { id: number; email: string; ownerChatId: string | null } | null;
  businesses: Business[];
  loading: boolean;
}

interface AuthContextType extends AuthState {
  login: (token: string, user: AuthState['user']) => void;
  logout: () => void;
  setBusinesses: (businesses: Business[]) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    token: localStorage.getItem('token'),
    user: null,
    businesses: [],
    loading: true,
  });

  useEffect(() => {
    if (!state.token) {
      setState((s) => ({ ...s, loading: false }));
      return;
    }

    api.getMe()
      .then(({ user, businesses }) => {
        setState((s) => ({ ...s, user, businesses, loading: false }));
      })
      .catch(() => {
        localStorage.removeItem('token');
        setState({ token: null, user: null, businesses: [], loading: false });
      });
  }, [state.token]);

  const login = useCallback((token: string, user: AuthState['user']) => {
    localStorage.setItem('token', token);
    setState({ token, user, businesses: [], loading: false });
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    setState({ token: null, user: null, businesses: [], loading: false });
  }, []);

  const setBusinesses = useCallback((businesses: Business[]) => {
    setState((s) => ({ ...s, businesses }));
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, logout, setBusinesses }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
