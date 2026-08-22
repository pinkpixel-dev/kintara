import { ArrowRight, BookOpen, Layers, LayoutPanelLeft } from "lucide-react";
import { BRAND_ASSET_PATHS } from "../lib/brand-assets";

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
            <img src={BRAND_ASSET_PATHS.logo} alt="" className="onboarding-logo-img" />
          </div>

          <h1 className="onboarding-title">Welcome to Kintara</h1>

          <div className="onboarding-features">
            <div className="onboarding-feature">
              <Layers className="onboarding-feature-icon" size={24} />
              <h3 className="onboarding-feature-title">Organize</h3>
            </div>
            <div className="onboarding-feature">
              <BookOpen className="onboarding-feature-icon" size={24} />
              <h3 className="onboarding-feature-title">Read</h3>
            </div>
            <div className="onboarding-feature">
              <LayoutPanelLeft className="onboarding-feature-icon" size={24} />
              <h3 className="onboarding-feature-title">Details</h3>
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
