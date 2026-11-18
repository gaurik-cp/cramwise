// The "Install app" button. Shows only when installing is possible here:
// one tap on Android/laptops, and the Share -> Add to Home Screen steps on iPhone.
import { useEffect, useState } from "react";
import { installMode, onInstallChange, promptInstall } from "../utils/install.js";
import { getSetting, setSetting } from "../utils/alerts.js";

export function useInstallMode() {
  const [mode, setMode] = useState(() => installMode());
  useEffect(() => onInstallChange(() => setMode(installMode())), []);
  return mode;
}

export default function InstallButton({ className = "btn btn-ghost", label = "Install app" }) {
  const mode = useInstallMode();
  const [steps, setSteps] = useState(false);
  if (!mode) return null;
  return (
    <>
      <button className={className} onClick={() => (mode === "ios" ? setSteps(true) : promptInstall())}>
        <PhoneIcon /> {label}
      </button>
      {steps && <IosSteps onClose={() => setSteps(false)} />}
    </>
  );
}

// iPhone has no install pop-up, so we show how to do it in Safari
export function IosSteps({ onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal install-steps" role="dialog" aria-modal="true" aria-labelledby="ios-title">
        <h2 id="ios-title" className="panel-title">
          Install Cramwise on your iPhone
        </h2>
        <ol>
          <li>
            Open this page in <b>Safari</b> (it doesn't work from Chrome on iPhone).
          </li>
          <li>
            Tap the <b>Share</b> button <ShareIcon /> at the bottom of the screen.
          </li>
          <li>
            Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.
          </li>
        </ol>
        <p className="muted">Cramwise then opens from your home screen like a normal app, full screen.</p>
        <div className="modal-actions">
          <span className="grow" />
          <button className="btn btn-primary" onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

function PhoneIcon() {
  return (
    <svg className="install-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <rect x="4" y="1" width="8" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 4.5v5M5.8 7.6 8 9.8l2.2-2.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-label="Share" style={{ verticalAlign: "-3px" }}>
      <path d="M8 1.5v8M5.2 4.2 8 1.5l2.8 2.7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.5 6.5H3.5v8h9v-8h-1" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

// A banner right under the player bar: "Get Cramwise on your home screen".
// "Not now" hides it for a week (it comes back, because it's easy to miss).
const SNOOZE_DAYS = 7;
export function InstallBanner() {
  const mode = useInstallMode();
  const [steps, setSteps] = useState(false);
  const [snoozedUntil, setSnoozedUntil] = useState(() => getSetting("cramwise-install-snooze", 0));
  if (!mode || Date.now() < snoozedUntil) return null;
  function snooze() {
    const until = Date.now() + SNOOZE_DAYS * 86400000;
    setSetting("cramwise-install-snooze", until);
    setSnoozedUntil(until);
  }
  return (
    <div className="install-banner" role="region" aria-label="Install the app">
      <span className="install-banner-icon" aria-hidden="true">
        <PhoneIcon />
      </span>
      <div className="install-banner-text">
        <b>Get the Cramwise app</b>
        <span>Opens from your home screen, full screen, and works with bad internet.</span>
      </div>
      <div className="install-banner-actions">
        <button className="btn btn-primary btn-small" onClick={() => (mode === "ios" ? setSteps(true) : promptInstall())}>
          Install
        </button>
        <button className="link-btn" onClick={snooze}>
          Not now
        </button>
      </div>
      {steps && <IosSteps onClose={() => setSteps(false)} />}
    </div>
  );
}
