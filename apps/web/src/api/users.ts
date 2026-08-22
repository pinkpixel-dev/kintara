import { api } from "./client";

export interface AccessUser {
  id: number;
  username: string;
  isAdmin: boolean;
  avatarUrl: string | null;
}
export interface Invitation { githubLogin: string; isAdmin: boolean; createdAt: string }
export interface AccessList { users: AccessUser[]; invitations: Invitation[] }

export const userService = {
  list: () => api.get<AccessList>("/api/users"),
  invite: (githubLogin: string, isAdmin: boolean) =>
    api.post<Invitation>("/api/users/invitations", { githubLogin, isAdmin }),
  removeInvitation: (login: string) =>
    api.delete<void>(`/api/users/invitations/${encodeURIComponent(login)}`),
  remove: (id: number) => api.delete<void>(`/api/users/${id}`),
};
