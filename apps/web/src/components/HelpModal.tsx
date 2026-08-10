import { X, HelpCircle, Settings, Plus, LayoutPanelLeft } from "lucide-react";

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function HelpModal({ isOpen, onClose }: HelpModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed-overlay animate-in fade-in duration-200">
      <div className="modal-content large">
        <div className="modal-header">
          <div className="flex items-center gap-2">
            <HelpCircle size={18} className="text-[var(--accent)]" />
            <h2 className="font-semibold text-lg m-0">Help & Shortcuts</h2>
          </div>
          <button className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] text-muted transition-colors border-none bg-transparent cursor-pointer" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        
        <div className="modal-body">
          
          <section>
            <h3 className="font-semibold mb-4 text-primary">Keyboard Shortcuts</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <div className="flex justify-between items-center bg-[var(--bg-tertiary)] p-2 rounded">
                <span className="text-secondary">Import Document</span>
                <kbd className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded px-2 py-0.5 font-mono text-xs shadow-sm">Ctrl + I</kbd>
              </div>
              <div className="flex justify-between items-center bg-[var(--bg-tertiary)] p-2 rounded">
                <span className="text-secondary">Search</span>
                <kbd className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded px-2 py-0.5 font-mono text-xs shadow-sm">Ctrl + F</kbd>
              </div>
              <div className="flex justify-between items-center bg-[var(--bg-tertiary)] p-2 rounded">
                <span className="text-secondary">Settings</span>
                <kbd className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded px-2 py-0.5 font-mono text-xs shadow-sm">Ctrl + ,</kbd>
              </div>
              <div className="flex justify-between items-center bg-[var(--bg-tertiary)] p-2 rounded">
                <span className="text-secondary">Close Tab</span>
                <kbd className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded px-2 py-0.5 font-mono text-xs shadow-sm">Ctrl + W</kbd>
              </div>
              <div className="flex justify-between items-center bg-[var(--bg-tertiary)] p-2 rounded">
                <span className="text-secondary">Toggle Sidebar</span>
                <kbd className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded px-2 py-0.5 font-mono text-xs shadow-sm">Ctrl + B</kbd>
              </div>
              <div className="flex justify-between items-center bg-[var(--bg-tertiary)] p-2 rounded">
                <span className="text-secondary">Toggle Help</span>
                <kbd className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded px-2 py-0.5 font-mono text-xs shadow-sm">F1</kbd>
              </div>
            </div>
          </section>

          <section>
            <h3 className="font-semibold mb-4 text-primary">Tips & Tricks</h3>
            <ul className="space-y-4 text-sm text-secondary">
              <li className="flex gap-3">
                <LayoutPanelLeft className="flex-shrink-0 text-[var(--accent)] mt-0.5" size={16} />
                <div>
                  <strong className="text-primary mr-1">Split View</strong>
                  Use the Columns icon in the reading view to open two documents side-by-side. Great for referencing notes while reading a PDF.
                </div>
              </li>
              <li className="flex gap-3">
                <Settings className="flex-shrink-0 text-[var(--accent)] mt-0.5" size={16} />
                <div>
                  <strong className="text-primary mr-1">Custom Appearance</strong>
                  Tweak the font family and size in Settings to make long reading sessions comfortable. Kintara supports system fonts and light/dark modes.
                </div>
              </li>
              <li className="flex gap-3">
                <Plus className="flex-shrink-0 text-[var(--accent)] mt-0.5" size={16} />
                <div>
                  <strong className="text-primary mr-1">Organize with Libraries & Collections</strong>
                  Create top-level Libraries for broad subjects, and nest Collections inside them. You can assign documents to any number of collections.
                </div>
              </li>
            </ul>
          </section>

        </div>
      </div>
    </div>
  );
}
