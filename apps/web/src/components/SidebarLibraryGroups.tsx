import {
  BookMarked, BookOpen, Bot, Briefcase, Building2, Camera, ChefHat,
  ChevronDown, ChevronRight, Coffee, Dumbbell, Film, FlaskConical,
  FolderOpen, Gamepad2, Globe, GraduationCap, Heart, Landmark, Leaf,
  Library as LibraryIcon, Microscope, Monitor, Music, Palette, Plane,
  Plus, Rocket, Settings, Star, TreePine, Waves, Code2,
} from "lucide-react";
import type { Collection, Library } from "../api";
import type { ActiveView } from "../lib/empty-reason";
import "./LibraryAccess.css";

const ICON_MAP: Record<string, React.ElementType> = {
  Library: LibraryIcon, BookOpen, BookMarked, FolderOpen, Palette,
  Monitor, Code2, Music, Film, Camera, FlaskConical, Dumbbell, Plane,
  Heart, Star, Coffee, Leaf, Globe, Briefcase, Gamepad2, GraduationCap,
  Microscope, Landmark, Building2, ChefHat, TreePine, Waves, Rocket, Bot,
};

interface SidebarLibraryGroupProps {
  title: string;
  libraries: Library[];
  collectionsByLibrary: Record<number, Collection[]>;
  expandedLibraries: Record<number, boolean>;
  expanded: boolean;
  activeView: ActiveView;
  onToggleGroup: () => void;
  onToggleLibrary: (id: number, event: React.MouseEvent) => void;
  onSelect: (view: ActiveView) => void;
  onCreateLibrary?: () => void;
  onImport: (target: { libraryId?: number; collectionId?: number }) => void;
  onOpenMenu: (event: React.MouseEvent<HTMLButtonElement>, library: Library) => void;
  onAddDocument: (libraryId: number, documentId: number) => Promise<void>;
  onAddToCollection: (collectionId: number, documentId: number) => Promise<void>;
  onOpenSettings: (type: "library" | "collection", id: number) => void;
  onError: (message: string) => void;
}

export function SidebarLibraryGroup({
  title,
  libraries,
  collectionsByLibrary,
  expandedLibraries,
  expanded,
  activeView,
  onToggleGroup,
  onToggleLibrary,
  onSelect,
  onCreateLibrary,
  onImport,
  onOpenMenu,
  onAddDocument,
  onAddToCollection,
  onOpenSettings,
  onError,
}: SidebarLibraryGroupProps) {
  const dropDocument = async (event: React.DragEvent, action: (id: number) => Promise<void>) => {
    event.preventDefault();
    const documentId = Number(event.dataTransfer.getData("text/plain"));
    if (!documentId) return;
    try {
      await action(documentId);
      window.dispatchEvent(new CustomEvent("refresh-documents"));
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not file that document.");
    }
  };

  return (
    <section className="sidebar-library-group">
      <div className="sidebar-section-label sidebar-section-heading">
        <button
          type="button"
          className="sidebar-section-toggle"
          onClick={onToggleGroup}
          aria-expanded={expanded}
        >
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          {title}
          <span className="sidebar-section-count">{libraries.length}</span>
        </button>
        {onCreateLibrary && (
          <button
            className="sidebar-section-add"
            title="New library"
            aria-label="New library"
            onClick={onCreateLibrary}
          >
            <Plus size={12} />
          </button>
        )}
      </div>

      {expanded && (
        <div className="sidebar-tree">
          {libraries.length === 0 && (
            <p className="sidebar-group-empty">
              {onCreateLibrary ? "No libraries yet." : "Nothing has been shared with you."}
            </p>
          )}
          {libraries.map((library) => {
            const isExpanded = expandedLibraries[library.id];
            const collections = collectionsByLibrary[library.id] ?? [];
            const isActive = activeView.type === "library" && activeView.id === library.id;
            const canEdit = library.accessRole !== "viewer";
            const isOwner = library.accessRole === "owner";
            const Icon = library.icon && ICON_MAP[library.icon] ? ICON_MAP[library.icon] : FolderOpen;

            return (
              <div key={library.id}>
                <div
                  className={`sidebar-item sidebar-library-row ${isActive ? "active" : ""}`}
                  onClick={() => onSelect({ type: "library", id: library.id })}
                  onDragOver={canEdit ? (event) => event.preventDefault() : undefined}
                  onDrop={canEdit ? (event) => dropDocument(event, (id) => onAddDocument(library.id, id)) : undefined}
                >
                  <div className="sidebar-row-label">
                    <button
                      className="sidebar-row-icon-btn"
                      onClick={(event) => onToggleLibrary(library.id, event)}
                      aria-label={`${isExpanded ? "Collapse" : "Expand"} ${library.name}`}
                      aria-expanded={isExpanded}
                    >
                      {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                    <Icon
                      size={14}
                      className="flex-shrink-0"
                      style={!isActive && library.iconColor ? { color: library.iconColor } : undefined}
                    />
                    <span className="sidebar-library-name">
                      <span className="truncate">{library.name}</span>
                      {!isOwner && <small>by {library.ownerUsername}</small>}
                    </span>
                  </div>

                  <div className="row-actions flex items-center flex-shrink-0">
                    {canEdit && (
                      <button
                        className="sidebar-row-action"
                        title={`Add to ${library.name}`}
                        aria-label={`Add to ${library.name}`}
                        aria-haspopup="menu"
                        onClick={(event) => onOpenMenu(event, library)}
                      >
                        <Plus size={14} />
                      </button>
                    )}
                    {isOwner && (
                      <button
                        className="sidebar-row-action"
                        title={`${library.name} settings and sharing`}
                        aria-label={`Settings and sharing for ${library.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpenSettings("library", library.id);
                        }}
                      >
                        <Settings size={14} />
                      </button>
                    )}
                  </div>
                </div>

                {isExpanded && collections.map((collection) => {
                  const collectionActive = activeView.type === "collection" && activeView.id === collection.id;
                  return (
                    <div
                      key={collection.id}
                      className={`sidebar-item sidebar-collection-row ${collectionActive ? "active" : ""}`}
                      onClick={() => onSelect({ type: "collection", id: collection.id })}
                      onDragOver={canEdit ? (event) => event.preventDefault() : undefined}
                      onDrop={canEdit ? (event) => dropDocument(event, (id) => onAddToCollection(collection.id, id)) : undefined}
                    >
                      <span className="sidebar-collection-dot" />
                      <span className="truncate flex-1 min-w-0">{collection.name}</span>
                      {canEdit && (
                        <div className="row-actions flex items-center flex-shrink-0">
                          <button
                            className="sidebar-row-action"
                            title={`Import into ${collection.name}`}
                            aria-label={`Import into ${collection.name}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              onImport({ libraryId: library.id, collectionId: collection.id });
                            }}
                          >
                            <Plus size={14} />
                          </button>
                          <button
                            className="sidebar-row-action"
                            title={`${collection.name} settings`}
                            aria-label={`Settings for ${collection.name}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              onOpenSettings("collection", collection.id);
                            }}
                          >
                            <Settings size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
