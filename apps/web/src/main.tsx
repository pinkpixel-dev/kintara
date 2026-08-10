import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AuthGate } from "./components/AuthGate";
import { applySettings, loadSettings } from "./lib/settings";

// Applied before the first render rather than in an effect, so the sign-in
// screen is already themed and nothing flashes from light to dark.
applySettings(loadSettings());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AuthGate>
      <App />
    </AuthGate>
  </React.StrictMode>,
);
