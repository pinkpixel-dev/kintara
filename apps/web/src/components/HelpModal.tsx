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
          <button className="modal-close" onClick={onClose} aria-label="Close help">
            <X size={18} />
          </button>
        </div>
        
        <div className="modal-body">
          
          <section>
            <h3 className="help-section-title">Keyboard Shortcuts</h3>
            <div className="shortcut-grid">
              <div className="shortcut-row">
                <span className="text-secondary">Import Document</span>
                <kbd className="shortcut-key">Ctrl + I</kbd>
              </div>
              <div className="shortcut-row">
                <span className="text-secondary">Search</span>
                <kbd className="shortcut-key">Ctrl + F</kbd>
              </div>
              <div className="shortcut-row">
                <span className="text-secondary">Settings</span>
                <kbd className="shortcut-key">Ctrl + ,</kbd>
              </div>
              <div className="shortcut-row">
                <span className="text-secondary">Close Tab</span>
                <kbd className="shortcut-key">Ctrl + W</kbd>
              </div>
              <div className="shortcut-row">
                <span className="text-secondary">Toggle Sidebar</span>
                <kbd className="shortcut-key">Ctrl + B</kbd>
              </div>
              <div className="shortcut-row">
                <span className="text-secondary">Toggle Help</span>
                <kbd className="shortcut-key">F1</kbd>
              </div>
            </div>
          </section>

          <section>
            <h3 className="help-section-title">Tips & Tricks</h3>
            <ul className="tip-list">
              <li className="tip-item">
                <LayoutPanelLeft className="tip-icon" size={16} />
                <div>
                  <strong className="tip-title">Split View</strong>
                  Use the Columns icon in the reading view to open two documents side-by-side. Great for referencing notes while reading a PDF.
                </div>
              </li>
              <li className="tip-item">
                <Settings className="tip-icon" size={16} />
                <div>
                  <strong className="tip-title">Custom Appearance</strong>
                  Tweak the font family and size in Settings to make long reading sessions comfortable. Kintara supports system fonts and light/dark modes.
                </div>
              </li>
              <li className="tip-item">
                <Plus className="tip-icon" size={16} />
                <div>
                  <strong className="tip-title">Organize with Libraries & Collections</strong>
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
