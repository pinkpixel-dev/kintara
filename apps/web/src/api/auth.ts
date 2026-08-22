import { api } from "./client";

export interface AuthUser {
  username: string;
  isAdmin: boolean;
  avatarUrl: string | null;
}

export interface AuthStatus {
  needsOwner: boolean;
  oauthConfigured: boolean;
  authenticated: boolean;
  user: AuthUser | null;
}

export const authService = {
  status(): Promise<AuthStatus> {
    return api.get("/api/auth/status");
  },

  githubStartUrl(): string {
    return "/api/auth/github/start";
  },

  logout(): Promise<void> {
    return api.post("/api/auth/logout");
  },
};
