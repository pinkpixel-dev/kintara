import { useEffect, useState } from "react";
import { UserMinus, UserPlus } from "lucide-react";
import { libraryService, type Library, type LibraryMember } from "../api";
import "./LibraryAccess.css";

interface LibrarySharingSectionProps {
  library: Library;
}

export function LibrarySharingSection({ library }: LibrarySharingSectionProps) {
  const [members, setMembers] = useState<LibraryMember[]>([]);
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<"viewer" | "editor">("viewer");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    try {
      setMembers(await libraryService.members(library.id));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not load sharing settings.");
    }
  };

  useEffect(() => {
    setUsername("");
    setRole("viewer");
    setMessage(null);
    load();
  }, [library.id]);

  const share = async (event: React.FormEvent) => {
    event.preventDefault();
    const login = username.trim();
    if (!login) return;
    setBusy(true);
    setMessage(null);
    try {
      await libraryService.share(library.id, login, role);
      setUsername("");
      setMessage(`Shared with ${login}.`);
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not share this library.");
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (member: LibraryMember, next: "viewer" | "editor") => {
    setBusy(true);
    setMessage(null);
    try {
      const updated = await libraryService.updateMember(library.id, member.userId, next);
      setMembers((items) => items.map((item) => item.userId === updated.userId ? updated : item));
      setMessage(`${member.username} is now an ${next}.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not update access.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (member: LibraryMember) => {
    setBusy(true);
    setMessage(null);
    try {
      await libraryService.removeMember(library.id, member.userId);
      setMembers((items) => items.filter((item) => item.userId !== member.userId));
      setMessage(`${member.username} no longer has access.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not remove access.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="library-sharing" aria-labelledby="library-sharing-title">
      <h3 id="library-sharing-title">Sharing</h3>

      <form className="library-share-form" onSubmit={share}>
        <label>
          GitHub username
          <input
            className="input"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="username"
            autoComplete="off"
          />
        </label>
        <label>
          Access
          <select
            className="input"
            value={role}
            onChange={(event) => setRole(event.target.value as "viewer" | "editor")}
          >
            <option value="viewer">Viewer</option>
            <option value="editor">Editor</option>
          </select>
        </label>
        <button className="btn btn-primary" type="submit" disabled={busy || !username.trim()}>
          <UserPlus size={14} aria-hidden="true" /> Share
        </button>
      </form>

      <div className="library-member-list" aria-label="People with access">
        {members.length === 0 && <p className="library-sharing-empty">Not shared with anyone.</p>}
        {members.map((member) => (
          <div className="library-member" key={member.userId}>
            <div>
              <strong>{member.username}</strong>
            </div>
            <select
              className="input"
              aria-label={`Access for ${member.username}`}
              value={member.role}
              disabled={busy}
              onChange={(event) => changeRole(member, event.target.value as "viewer" | "editor")}
            >
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
            </select>
            <button
              className="btn btn-ghost library-member-remove"
              type="button"
              disabled={busy}
              onClick={() => remove(member)}
              aria-label={`Remove ${member.username} from ${library.name}`}
              title={`Remove ${member.username}`}
            >
              <UserMinus size={14} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>

      {message && <p className="settings-message" role="status">{message}</p>}
    </section>
  );
}
