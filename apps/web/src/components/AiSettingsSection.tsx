import { useEffect, useState } from "react";
import { Bot } from "lucide-react";
import { ApiError, aiService, type AiSettings, type ModelCatalog } from "../api";
import type { UpdateAiSettings } from "../api/ai";

interface Props { onSaved: (settings: AiSettings) => void }

export function AiSettingsSection({ onSaved }: Props) {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [models, setModels] = useState<ModelCatalog | null>(null);
  const [openaiKey, setOpenaiKey] = useState("");
  const [googleKey, setGoogleKey] = useState("");
  const [removeOpenai, setRemoveOpenai] = useState(false);
  const [removeGoogle, setRemoveGoogle] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([aiService.settings(), aiService.models()])
      .then(([next, catalog]) => { setSettings(next); setModels(catalog); })
      .catch((error) => setMessage(error instanceof ApiError ? error.message : "Could not load AI settings."));
  }, []);

  if (!settings || !models) return <section><p className="text-sm text-muted">Loading AI settings…</p></section>;
  const selectedModels = settings.provider === "openai" ? models.openai : models.google;
  const selectedModel = settings.provider === "openai" ? settings.openaiModel : settings.googleModel;
  const capability = selectedModels.find((model) => model.id === selectedModel) ?? selectedModels[0];
  // Image models are a separate catalogue with no reasoning levels of their own.
  const imageModels = settings.provider === "openai" ? models.openaiImage : models.googleImage;
  const imageModel = settings.provider === "openai"
    ? settings.openaiImageModel : settings.googleImageModel;

  const update = <K extends keyof AiSettings>(key: K, value: AiSettings[K]) =>
    setSettings((current) => current ? { ...current, [key]: value } : current);

  const selectModel = (id: string) => {
    const nextCapability = selectedModels.find((model) => model.id === id);
    setSettings((current) => {
      if (!current || !nextCapability) return current;
      if (current.provider === "openai") {
        return { ...current, openaiModel: id, openaiReasoning: nextCapability.reasoning.includes(current.openaiReasoning) ? current.openaiReasoning : "medium" };
      }
      return { ...current, googleModel: id, googleThinking: nextCapability.reasoning.includes(current.googleThinking) ? current.googleThinking : "medium" };
    });
  };

  const payload = (): UpdateAiSettings => ({
    enabled: settings.enabled,
    provider: settings.provider,
    openaiModel: settings.openaiModel,
    googleModel: settings.googleModel,
    openaiReasoning: settings.openaiReasoning,
    googleThinking: settings.googleThinking,
    temperature: settings.provider === "openai" && settings.openaiReasoning === "none"
      ? settings.temperature : null,
    openaiImageModel: settings.openaiImageModel,
    googleImageModel: settings.googleImageModel,
    openaiApiKey: openaiKey.trim() || undefined,
    googleApiKey: googleKey.trim() || undefined,
    removeOpenaiKey: removeOpenai,
    removeGoogleKey: removeGoogle,
  });

  const save = async () => {
    setBusy(true); setMessage(null);
    try {
      const next = await aiService.updateSettings(payload());
      setSettings(next); setOpenaiKey(""); setGoogleKey("");
      setRemoveOpenai(false); setRemoveGoogle(false); onSaved(next);
      setMessage("AI settings saved.");
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "Could not save AI settings.");
    } finally { setBusy(false); }
  };

  const test = async () => {
    setBusy(true); setMessage("Testing the saved connection…");
    try { await aiService.test(); setMessage("Connection works."); }
    catch (error) { setMessage(error instanceof ApiError ? error.message : "Connection test failed."); }
    finally { setBusy(false); }
  };

  return (
    <section>
      <h3 className="settings-section-title"><Bot size={14} /> AI</h3>
      <div className="settings-section-body ai-settings">
        <label className="settings-switch"><strong>Enable AI</strong>
          <input type="checkbox" checked={settings.enabled} onChange={(e) => update("enabled", e.target.checked)} />
        </label>
        <label>Provider
          <select className="input" value={settings.provider} onChange={(e) => update("provider", e.target.value as AiSettings["provider"])}>
            <option value="openai">OpenAI</option><option value="google">Google Gemini</option>
          </select>
        </label>
        <div className="ai-key-grid">
          <KeyField label="OpenAI API key" status={settings.openaiKey} value={openaiKey}
            remove={removeOpenai} onValue={setOpenaiKey} onRemove={setRemoveOpenai} />
          <KeyField label="Google API key" status={settings.googleKey} value={googleKey}
            remove={removeGoogle} onValue={setGoogleKey} onRemove={setRemoveGoogle} />
        </div>
        <label>Model
          <select className="input" value={selectedModel} onChange={(e) => selectModel(e.target.value)}>
            {selectedModels.map((model) => <option key={model.id}>{model.id}</option>)}
          </select>
        </label>
        <label>{settings.provider === "openai" ? "Reasoning effort" : "Thinking level"}
          <select className="input" value={settings.provider === "openai" ? settings.openaiReasoning : settings.googleThinking}
            onChange={(e) => update(settings.provider === "openai" ? "openaiReasoning" : "googleThinking", e.target.value)}>
            {capability.reasoning.map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>
        <label>Cover image model
          <select className="input" value={imageModel}
            onChange={(e) => update(
              settings.provider === "openai" ? "openaiImageModel" : "googleImageModel",
              e.target.value,
            )}>
            {imageModels.map((id) => <option key={id}>{id}</option>)}
          </select>
        </label>
        {settings.provider === "openai" && (
          <p className="text-xs text-muted">GPT Image models need organization verification on
            your OpenAI account, and their endpoint has no retention setting — cover prompts
            are the one request Kintara cannot send with storage disabled.</p>
        )}
        {settings.provider === "openai" && settings.openaiReasoning === "none" && capability.supportsTemperature && (
          <label>Temperature <input className="input" type="number" min="0" max="2" step="0.1"
            value={settings.temperature ?? 1} onChange={(e) => update("temperature", Number(e.target.value))} /></label>
        )}
        <p className="text-xs text-muted">Usage recorded here: {settings.usage.inputTokens.toLocaleString()} input / {settings.usage.outputTokens.toLocaleString()} output tokens.</p>
        {message && <p className="settings-message" role="status">{message}</p>}
        <div className="settings-actions"><button className="btn btn-ghost" disabled={busy} onClick={test}>Test saved key</button>
          <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Working…" : "Save AI settings"}</button></div>
      </div>
    </section>
  );
}

function KeyField({ label, status, value, remove, onValue, onRemove }: {
  label: string; status: AiSettings["openaiKey"]; value: string; remove: boolean;
  onValue: (value: string) => void; onRemove: (value: boolean) => void;
}) {
  return <label>{label}<span className="key-status">{status.set ? `Saved ••••${status.hint}` : "Not set"}</span>
    <input className="input" type="password" autoComplete="off" placeholder={status.set ? "Enter a replacement" : "Paste key"}
      value={value} disabled={remove} onChange={(e) => onValue(e.target.value)} />
    {status.set && <span className="key-remove"><input type="checkbox" checked={remove} onChange={(e) => onRemove(e.target.checked)} /> Remove saved key</span>}
  </label>;
}
