import { createContext, useContext, useState, type ReactNode } from "react";

// Hardcoded demo credentials — replace with real auth later.
const DUMMY_USERNAME = "admin";
const DUMMY_PASSWORD = "12345678";

const STORAGE_KEY = "agentspeak_auth";

interface AuthContextValue {
  isAuthenticated: boolean;
  login: (username: string, password: string) => boolean;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(
    () => localStorage.getItem(STORAGE_KEY) === "true",
  );

  const login = (username: string, password: string) => {
    const ok = username === DUMMY_USERNAME && password === DUMMY_PASSWORD;
    if (ok) {
      localStorage.setItem(STORAGE_KEY, "true");
      setIsAuthenticated(true);
    }
    return ok;
  };

  const logout = () => {
    localStorage.removeItem(STORAGE_KEY);
    setIsAuthenticated(false);
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}