import { FileText, FolderOpen, Search, Star, Upload } from "lucide-react";

export type EmptyReason =
  | { kind: "search"; query: string; scopeName: string | null }
  | { kind: "scope"; scopeName: string }
  | { kind: "favorites" }
  | { kind: "recent" }
  | { kind: "library" };

interface EmptyStateProps {
  reason: EmptyReason;
  /** Drops the scope but keeps the query, so the same search runs everywhere. */
  onSearchEverywhere: () => void;
  onImport: () => void;
}

/**
 * What to say when the grid has nothing in it.
 *
 * The single "No documents found in this view" this replaced covered an empty
 * library and a search that matched nothing equally badly. That is worst on a
 * phone, where the scope chip lives inside the drawer: a search with no results
 * looked exactly like a library that had lost its contents, with the reason
 * off-screen. Each message now names what actually produced the empty list, and
 * the two cases someone can act on carry the action with them.
 */
export function EmptyState({ reason, onSearchEverywhere, onImport }: EmptyStateProps) {
  const content = describe(reason);

  return (
    <div className="empty-state" role="status">
      <content.Icon className="empty-state-icon" size={32} aria-hidden="true" />
      <p className="empty-state-title">{content.title}</p>
      <p className="empty-state-body">{content.body}</p>
      {content.action === "search-everywhere" ? (
        <button className="btn btn-ghost empty-state-action" onClick={onSearchEverywhere}>
          <Search size={16} aria-hidden="true" /> Search everywhere
        </button>
      ) : null}
      {content.action === "import" ? (
        <button className="btn btn-primary empty-state-action" onClick={onImport}>
          <Upload size={16} aria-hidden="true" /> Import a document
        </button>
      ) : null}
    </div>
  );
}

function describe(reason: EmptyReason) {
  switch (reason.kind) {
    case "search":
      // Offering "search everywhere" only where there is somewhere wider to go.
      // Unscoped, the search has already covered everything.
      return reason.scopeName
        ? {
            Icon: Search,
            title: `No matches in ${reason.scopeName}`,
            body: `Nothing in ${reason.scopeName} matches “${reason.query}”.`,
            action: "search-everywhere" as const,
          }
        : {
            Icon: Search,
            title: "No matches",
            body: `Nothing in your library matches “${reason.query}”.`,
            action: null,
          };

    case "scope":
      return {
        Icon: FolderOpen,
        title: `${reason.scopeName} is empty`,
        body: "Nothing has been filed here yet.",
        action: "import" as const,
      };

    case "favorites":
      return {
        Icon: Star,
        title: "No favorites yet",
        body: "Star a document and it will show up here.",
        action: null,
      };

    case "recent":
      return {
        Icon: FileText,
        title: "Nothing opened yet",
        body: "Documents you open will appear here.",
        action: null,
      };

    case "library":
      return {
        Icon: Upload,
        title: "Your library is empty",
        body: "Import a document, or drop files into the library folder and let the scanner find them.",
        action: "import" as const,
      };
  }
}
