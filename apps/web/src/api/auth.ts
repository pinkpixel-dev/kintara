import { api } from "./client";

export interface AuthUser {
  username: string;
  isAdmin: boolean;
}

export interface AuthStatus {
  /** True until a password has been set, which puts the app into first-run setup. */
  needsSetup: boolean;
  authenticated: boolean;
  user: AuthUser | null;
}

export const authService = {
  status(): Promise<AuthStatus> {
    return api.get("/api/auth/status");
  },

  /** First run only: names the owner account and sets its password. */
  setup(username: string, password: string): Promise<void> {
    return api.post("/api/auth/setup", { username, password });
  },

  login(username: string, password: string): Promise<void> {
    return api.post("/api/auth/login", { username, password });
  },

  logout(): Promise<void> {
    return api.post("/api/auth/logout");
  },
};
