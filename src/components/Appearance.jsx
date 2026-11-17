// Appearance pop-up: choose dark / light / auto and an accent colour.
import { useEffect } from "react";
import { ACCENTS } from "../utils/look.js";

const THEME_INFO = [
  { id: "dark", label: "Dark", hint: "Arcade at night" },
  { id: "light", label: "Light", hint: "Arcade in daylight" },
  { id: "auto", label: "Auto", hint: "Follows your device" },
];

export default function Appearance({ look, onChange, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="look-title">
        <h2 id="look-title" className="panel-title">
          Appearance
        </h2>
        <p className="field-label">Theme</p>
        <div className="theme-pick" role="radiogroup" aria-label="Theme">
          {THEME_INFO.map((t) => (
            <button key={t.id} role="radio" aria-checked={look.theme === t.id} className={`theme-opt theme-${t.id} ${look.theme === t.id ? "on" : ""}`} onClick={() => onChange({ ...look, theme: t.id })}>
              <span className="theme-preview" aria-hidden="true">
                <i />
                <i />
              </span>
              <b>{t.label}</b>
              <small>{t.hint}</small>
            </button>
          ))}
        </div>
        <p className="field-label">Accent colour</p>
        <div className="accent-pick" role="radiogroup" aria-label="Accent colour">
          {ACCENTS.map((a) => (
            <button key={a.id} role="radio" aria-checked={look.accent === a.id} className={`accent-opt ${look.accent === a.id ? "on" : ""}`} onClick={() => onChange({ ...look, accent: a.id })}>
              <span className="swatch" style={{ background: a.swatch }} aria-hidden="true" />
              {a.label}
            </button>
          ))}
        </div>
        <div className="modal-actions">
          <span className="grow" />
          <button className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
