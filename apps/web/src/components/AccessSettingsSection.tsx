import { useEffect, useState } from "react";
import { ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { ApiError } from "../api";
import { authService } from "../api/auth";
import { userService, type AccessList } from "../api/users";
import { ConfirmDialog } from "./ConfirmDialog";

export function AccessSettingsSection() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [currentUsername, setCurrentUsername] = useState<string | null>(null);
  const [access, setAccess] = useState<AccessList | null>(null);
  const [login, setLogin] = useState("");
  const [admin, setAdmin] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<{ id: number; username: string } | null>(null);

  const load = async () => {
    const status = await authService.status();
    setIsAdmin(Boolean(status.user?.isAdmin));
    setCurrentUsername(status.user?.username ?? null);
    if (status.user?.isAdmin) setAccess(await userService.list());
  };
  useEffect(() => { load().catch(() => setMessage("Could not load access settings.")); }, []);
  if (!isAdmin) return null;

  const invite = async (event: React.FormEvent) => {
    event.preventDefault(); setMessage(null);
    try { await userService.invite(login, admin); setLogin(""); setAdmin(false); await load(); setMessage("Invitation saved."); }
    catch (error) { setMessage(error instanceof ApiError ? error.message : "Could not save invitation."); }
  };
  const removeInvitation = async (value: string) => { await userService.removeInvitation(value); await load(); };
  const removeUser = async () => {
    if (!pendingRemoval) return;
    await userService.remove(pendingRemoval.id); setPendingRemoval(null); await load();
  };

  return <section>
    <ConfirmDialog isOpen={pendingRemoval !== null} title="Remove user"
      message={pendingRemoval ? `Remove @${pendingRemoval.username} from Kintara? Their saved AI settings and sessions will also be removed.` : ""}
      confirmLabel="Remove" danger onConfirm={removeUser} onCancel={() => setPendingRemoval(null)} />
    <h3 className="settings-section-title"><ShieldCheck size={14} /> Access</h3>
    <div className="settings-section-body">
      <p className="text-xs text-muted">Only invited GitHub accounts can join this Kintara.</p>
      <form className="access-invite" onSubmit={invite}>
        <label>GitHub username<input className="input" value={login} onChange={(e) => setLogin(e.target.value)} required /></label>
        <label className="key-remove"><input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} /> Administrator</label>
        <button className="btn btn-primary" type="submit"><UserPlus size={16} /> Invite</button>
      </form>
      {access?.users.map((user) => <div className="access-row" key={user.id}>
        <span><strong>@{user.username}</strong><small>{user.isAdmin ? "Administrator" : "Member"}</small></span>
        {user.username.toLowerCase() !== currentUsername?.toLowerCase() && <button className="header-icon-btn" aria-label={`Remove ${user.username}`} title={`Remove ${user.username}`} onClick={() => setPendingRemoval({ id: user.id, username: user.username })}><Trash2 size={16} /></button>}
      </div>)}
      {access?.invitations.map((invite) => <div className="access-row" key={invite.githubLogin}>
        <span><strong>@{invite.githubLogin}</strong><small>Pending{invite.isAdmin ? " administrator" : ""}</small></span>
        <button className="header-icon-btn" aria-label={`Revoke invitation for ${invite.githubLogin}`} onClick={() => removeInvitation(invite.githubLogin)}><Trash2 size={16} /></button>
      </div>)}
      {message && <p className="settings-message" role="status">{message}</p>}
    </div>
  </section>;
}
