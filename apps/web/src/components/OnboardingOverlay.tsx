import { ArrowRight, BookOpen, Layers, LayoutPanelLeft } from "lucide-react";

interface OnboardingOverlayProps {
  onComplete: () => void;
}

/**
 * The first-run welcome screen.
 *
 * Layout lives in `App.css` under `.onboarding-*` rather than in utility
 * classes here. The earlier version was assembled from `p-10`, `p-5` and
 * `grid grid-cols-1 md:grid-cols-3 gap-6`, none of which this project defines,
 * so it rendered with no padding and the three cards stacked at every width.
 */
export function OnboardingOverlay({ onComplete }: OnboardingOverlayProps) {
  return (
    <div className="fixed-overlay z-100 animate-in fade-in zoom-in duration-500">
      <div className="onboarding-container">
        <div className="onboarding-body">
          <div className="onboarding-logo">
            <img src="/logo.png" alt="" className="onboarding-logo-img" />
          </div>

          <h1 className="onboarding-title">Welcome to Kintara</h1>
          <p className="onboarding-subtitle">
            Your minimal, powerful document manager and reader.
          </p>

          <div className="onboarding-features">
            <div className="onboarding-feature">
              <Layers className="onboarding-feature-icon" size={24} />
              <h3 className="onboarding-feature-title">Organize</h3>
              <p className="text-sm text-muted">
                Create Libraries and nested Collections to keep your research structured.
              </p>
            </div>
            <div className="onboarding-feature">
              <BookOpen className="onboarding-feature-icon" size={24} />
              <h3 className="onboarding-feature-title">Read</h3>
              <p className="text-sm text-muted">
                A distraction-free reading environment for PDFs, Markdown, and text files.
              </p>
            </div>
            <div className="onboarding-feature">
              <LayoutPanelLeft className="onboarding-feature-icon" size={24} />
              <h3 className="onboarding-feature-title">Details</h3>
              <p className="text-sm text-muted">
                View extracted metadata and add notes alongside your documents.
              </p>
            </div>
          </div>

          <button className="btn btn-primary onboarding-cta" onClick={onComplete}>
            Get Started <ArrowRight size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
