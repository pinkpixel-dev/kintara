import { useState, useEffect } from "react";
import { Search, Library as LibraryIcon, Star, Plus, ChevronRight, ChevronDown, FolderOpen, Settings, HelpCircle, Edit2, X } from "lucide-react";
import { Library, Collection, libraryService, collectionService } from "../db";

interface SidebarProps {
  isOpen: boolean;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  activeView: { type: 'all' | 'recent' | 'favorites' | 'library' | 'collection', id?: number };
  setActiveView: (view: { type: 'all' | 'recent' | 'favorites' | 'library' | 'collection', id?: number }) => void;
  onImport: () => void;
}

export function Sidebar({ isOpen, searchQuery, setSearchQuery, activeView, setActiveView, onImport }: SidebarProps) {
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [collectionsByLibrary, setCollectionsByLibrary] = useState<Record<number, Collection[]>>({});
  const [expandedLibraries, setExpandedLibraries] = useState<Record<number, boolean>>({});

  const [promptConfig, setPromptConfig] = useState<{
    isOpen: boolean;
    title: string;
    placeholder: string;
    initialValue: string;
    onSave: (val: string) => Promise<void>;
  }>({
    isOpen: false, title: '', placeholder: '', initialValue: '', onSave: async () => {}
  });
  const [promptValue, setPromptValue] = useState("");

  const loadData = async () => {
    try {
      let libs = await libraryService.getAll();
      if (libs.length === 0) {
        await libraryService.create("My Library", "#410186");
        libs = await libraryService.getAll();
      }
      setLibraries(libs);

      // Load collections for each library
      const colMap: Record<number, Collection[]> = {};
      const expMap: Record<number, boolean> = { ...expandedLibraries };
      for (const lib of libs) {
        const cols = await collectionService.getAllForLibrary(lib.id);
        colMap[lib.id] = cols;
        if (expMap[lib.id] === undefined) expMap[lib.id] = true; // expand by default
      }
      setCollectionsByLibrary(colMap);
      setExpandedLibraries(expMap);
    } catch (err) {
      console.error("Failed to load libraries", err);
    }
  };

  useEffect(() => {
    loadData();
    
    // Listen for custom event to trigger library rename for onboarding
    const handleRenamePrompt = () => {
      openPrompt("Name your first library", "Library name...", "My Library", async (val) => {
        const libs = await libraryService.getAll();
        if (libs.length > 0) {
          await libraryService.rename(libs[0].id, val);
          await loadData();
        }
      });
    };
    window.addEventListener('prompt-rename-first-library', handleRenamePrompt);
    return () => window.removeEventListener('prompt-rename-first-library', handleRenamePrompt);
  }, []);

  const toggleLibrary = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedLibraries(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const openPrompt = (title: string, placeholder: string, initialValue: string, onSave: (val: string) => Promise<void>) => {
    setPromptValue(initialValue);
    setPromptConfig({ isOpen: true, title, placeholder, initialValue, onSave });
  };

  const closePrompt = () => {
    setPromptConfig(prev => ({ ...prev, isOpen: false }));
  };

  const handlePromptSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (promptValue.trim()) {
      await promptConfig.onSave(promptValue.trim());
      closePrompt();
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <aside className="sidebar transition-all duration-300 flex-shrink-0 flex flex-col h-full bg-[var(--bg-secondary)] border-r border-[var(--border-color)]">
        <div className="sidebar-header flex justify-between items-center px-4 py-3 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="Kintara Logo" className="w-8 h-8 object-contain" />
            <span className="font-bold text-lg text-primary tracking-wide">Kintara</span>
          </div>
          <button className="btn btn-ghost p-1.5 hover:bg-[var(--bg-tertiary)] rounded text-muted hover:text-primary transition-colors border-none bg-transparent cursor-pointer" onClick={onImport} title="Import Document">
            <Plus size={18} />
          </button>
        </div>
        
        <div className="sidebar-content flex-1 overflow-y-auto px-2 py-4 flex flex-col gap-4">
          <div className="relative px-2">
            <Search className="absolute left-4 top-2.5 text-muted" size={14} />
            <input 
              type="text" 
              placeholder="Search documents..." 
              className="input pl-8 py-2 text-sm w-full bg-[var(--bg-tertiary)] border-transparent focus:border-[var(--accent)]"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div>
            <div className="text-[10px] uppercase text-muted mb-1 px-3 font-semibold tracking-wider">Quick Views</div>
            <div 
              className={`sidebar-item flex items-center gap-2 px-3 py-1.5 rounded-md cursor-pointer text-sm mb-0.5 ${activeView.type === 'all' ? 'bg-[var(--bg-tertiary)] text-[var(--accent)] font-medium' : 'text-secondary hover:bg-[var(--bg-tertiary)]'}`}
              onClick={() => setActiveView({ type: 'all' })}
            >
              <LibraryIcon size={16} /> All Documents
            </div>
            <div 
              className={`sidebar-item flex items-center gap-2 px-3 py-1.5 rounded-md cursor-pointer text-sm mb-0.5 ${activeView.type === 'favorites' ? 'bg-[var(--bg-tertiary)] text-[var(--accent)] font-medium' : 'text-secondary hover:bg-[var(--bg-tertiary)]'}`}
              onClick={() => setActiveView({ type: 'favorites' })}
            >
              <Star size={16} /> Favorites
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase text-muted mb-1 px-3 font-semibold tracking-wider flex justify-between items-center group">
              Libraries
              <button 
                className="p-0.5 text-muted hover:text-primary bg-transparent border-none cursor-pointer rounded hover:bg-[var(--bg-tertiary)] opacity-0 group-hover:opacity-100 transition-opacity"
                title="New Library"
                onClick={() => {
                  openPrompt("Create Library", "Library name...", "", async (val) => {
                    await libraryService.create(val);
                    await loadData();
                  });
                }}
              >
                <Plus size={12} />
              </button>
            </div>
            <div className="flex flex-col gap-0.5">
              {libraries.map(lib => {
                const isExpanded = expandedLibraries[lib.id];
                const collections = collectionsByLibrary[lib.id] || [];
                const isActiveLib = activeView.type === 'library' && activeView.id === lib.id;
                
                return (
                  <div key={`lib-${lib.id}`}>
                    <div 
                      className={`sidebar-item flex items-center justify-between px-2 py-1.5 rounded-md cursor-pointer text-sm group ${isActiveLib ? 'bg-[var(--bg-tertiary)] text-[var(--accent)] font-medium' : 'text-secondary hover:bg-[var(--bg-tertiary)]'}`}
                      onClick={() => setActiveView({ type: 'library', id: lib.id })}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <button 
                          className="p-0.5 flex items-center justify-center bg-transparent border-none cursor-pointer hover:bg-black/10 rounded text-muted transition-colors"
                          onClick={(e) => toggleLibrary(lib.id, e)}
                        >
                          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                        <FolderOpen size={14} className={`flex-shrink-0 ${isActiveLib ? 'text-[var(--accent)]' : 'text-muted'}`} />
                        <span className="truncate">{lib.name}</span>
                      </div>
                      
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                        <button 
                          className="p-1 text-muted hover:text-primary bg-transparent border-none cursor-pointer rounded hover:bg-black/10"
                          title="Rename Library"
                          onClick={(e) => {
                            e.stopPropagation();
                            openPrompt("Rename Library", "Library name...", lib.name, async (val) => {
                              await libraryService.rename(lib.id, val);
                              await loadData();
                            });
                          }}
                        >
                          <Edit2 size={12} />
                        </button>
                        <button 
                          className="p-1 text-muted hover:text-primary bg-transparent border-none cursor-pointer rounded hover:bg-black/10"
                          title="New Collection"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedLibraries(prev => ({ ...prev, [lib.id]: true }));
                            openPrompt("New Collection", "Collection name...", "", async (val) => {
                              await collectionService.create(lib.id, val);
                              await loadData();
                            });
                          }}
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                    </div>
                    
                    {isExpanded && collections.map(col => {
                      const isActiveCol = activeView.type === 'collection' && activeView.id === col.id;
                      return (
                        <div 
                          key={`col-${col.id}`}
                          className={`flex items-center gap-2 pl-9 pr-3 py-1.5 rounded-md cursor-pointer text-sm ${isActiveCol ? 'bg-[var(--bg-tertiary)] text-[var(--accent)] font-medium' : 'text-muted hover:text-secondary hover:bg-[var(--bg-tertiary)]'}`}
                          onClick={() => setActiveView({ type: 'collection', id: col.id })}
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-current opacity-50 flex-shrink-0"></span>
                          <span className="truncate">{col.name}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        
        {/* Sidebar Footer */}
        <div className="mt-auto px-4 py-3 border-t border-[var(--border-color)] flex justify-between items-center bg-[var(--bg-primary)]">
          <button 
            className="btn btn-ghost p-2 rounded-md hover:bg-[var(--bg-tertiary)] text-muted hover:text-primary transition-colors flex items-center justify-center border-none cursor-pointer bg-transparent"
            onClick={() => window.dispatchEvent(new CustomEvent('open-settings'))}
            title="Settings (Ctrl+,)"
          >
            <Settings size={18} />
          </button>
          <button 
            className="btn btn-ghost p-2 rounded-md hover:bg-[var(--bg-tertiary)] text-muted hover:text-primary transition-colors flex items-center justify-center border-none cursor-pointer bg-transparent"
            onClick={() => window.dispatchEvent(new CustomEvent('open-help'))}
            title="Help & Shortcuts (F1)"
          >
            <HelpCircle size={18} />
          </button>
        </div>
      </aside>

      {/* Reusable Prompt Modal */}
      {promptConfig.isOpen && (
        <div className="fixed-overlay z-100 animate-in fade-in duration-200">
          <div className="modal-content" style={{ maxWidth: '350px' }}>
            <div className="modal-header">
              <h2 className="font-semibold text-md m-0">{promptConfig.title}</h2>
              <button className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] text-muted transition-colors border-none bg-transparent cursor-pointer" onClick={closePrompt}>
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handlePromptSubmit} className="modal-body">
              <input 
                type="text"
                autoFocus
                className="input py-2 px-3 text-sm"
                placeholder={promptConfig.placeholder}
                value={promptValue}
                onChange={(e) => setPromptValue(e.target.value)}
              />
              <div className="flex justify-end gap-2 mt-2">
                <button type="button" className="btn btn-ghost" onClick={closePrompt}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={!promptValue.trim()}>Save</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
