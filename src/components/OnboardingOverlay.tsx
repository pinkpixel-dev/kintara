import { ArrowRight, BookOpen, Layers, LayoutPanelLeft } from "lucide-react";

interface OnboardingOverlayProps {
  onComplete: () => void;
}

export function OnboardingOverlay({ onComplete }: OnboardingOverlayProps) {
  return (
    <div className="fixed-overlay z-100 animate-in fade-in zoom-in duration-500">
      <div className="onboarding-container">
        {/* Decorative background glow */}
        <div className="absolute -top-32 -left-32 w-64 h-64 bg-[var(--accent)] rounded-full blur-[100px] opacity-20 pointer-events-none"></div>
        <div className="absolute -bottom-32 -right-32 w-64 h-64 bg-cyan-500 rounded-full blur-[100px] opacity-20 pointer-events-none"></div>

        <div className="p-10 text-center relative z-10 flex flex-col items-center">
          <div className="w-20 h-20 mb-6 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl flex items-center justify-center shadow-lg">
            <img src="/logo.png" alt="Logo" className="w-12 h-12" />
          </div>
          
          <h1 className="text-3xl font-bold mb-3 tracking-tight text-primary">Welcome to Kintara</h1>
          <p className="text-secondary text-lg mb-10 max-w-lg">Your minimal, powerful document manager and reader.</p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10 w-full text-left">
            <div className="bg-[var(--bg-secondary)] p-5 rounded-xl border border-[var(--border-color)]">
              <Layers className="text-[var(--accent)] mb-3" size={24} />
              <h3 className="font-semibold text-primary mb-2">Organize</h3>
              <p className="text-sm text-muted">Create Libraries and nested Collections to keep your research structured.</p>
            </div>
            <div className="bg-[var(--bg-secondary)] p-5 rounded-xl border border-[var(--border-color)]">
              <BookOpen className="text-cyan-400 mb-3" size={24} />
              <h3 className="font-semibold text-primary mb-2">Read</h3>
              <p className="text-sm text-muted">A distraction-free reading environment for PDFs, Markdown, and text files.</p>
            </div>
            <div className="bg-[var(--bg-secondary)] p-5 rounded-xl border border-[var(--border-color)]">
              <LayoutPanelLeft className="text-pink-400 mb-3" size={24} />
              <h3 className="font-semibold text-primary mb-2">Details</h3>
              <p className="text-sm text-muted">View extracted metadata and add notes alongside your documents.</p>
            </div>
          </div>

          <button 
            className="btn btn-primary px-8 py-3 text-lg font-medium rounded-full shadow-lg shadow-[var(--accent)]/30 hover:shadow-[var(--accent)]/50 transition-all flex items-center gap-2"
            onClick={onComplete}
          >
            Get Started <ArrowRight size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
