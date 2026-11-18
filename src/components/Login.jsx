// Sign-in screen: Google button, or use the app without an account.
import { useEffect, useRef, useState } from "react";
import { api, loadGoogleScript } from "../utils/api.js";

export default function Login({ config, serverDown, onSignedIn, onUseLocal }) {
  const buttonRef = useRef(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Draw Google's official button once the script has loaded
  useEffect(() => {
    if (!config?.googleClientId) return;
    let cancelled = false;
    loadGoogleScript()
      .then(() => {
        if (cancelled || !buttonRef.current) return;
        window.google.accounts.id.initialize({
          client_id: config.googleClientId,
          callback: async ({ credential }) => {
            setBusy(true);
            setError("");
            try {
              const { user } = await api("/api/auth/google", { method: "POST", json: { credential } });
              onSignedIn(user);
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          },
        });
        window.google.accounts.id.renderButton(buttonRef.current, {
          theme: "filled_black",
          size: "large",
          shape: "rectangular",
          text: "continue_with",
          width: 300,
        });
      })
      .catch((e) => setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [config?.googleClientId, onSignedIn]);

  async function devLogin() {
    setBusy(true);
    try {
      const { user } = await api("/api/auth/dev", { method: "POST" });
      onSignedIn(user);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="login">
      <h1 className="setup-title">Turn exam prep into a game.</h1>
      <p className="lead">
        Study sessions are quests, exams are bosses, and every chapter you finish earns XP. Sign in to save your
        progress online and use the AI coach.
      </p>

      <div className="login-box">
        {serverDown ? (
          <p className="error">
            The Cramwise server isn't running, so sign-in isn't available. You can still use the app on this device.
          </p>
        ) : config?.googleClientId ? (
          <div ref={buttonRef} className="google-btn" aria-busy={busy} />
        ) : (
          <p className="hint-box">
            Google sign-in isn't set up yet. Add your Google client ID to <code>server/.env</code> (see
            SETUP-ONLINE.md).
          </p>
        )}

        {config?.devLogin && !serverDown && (
          <button className="btn btn-primary" onClick={devLogin} disabled={busy}>
            Test login (this laptop only)
          </button>
        )}

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <div className="login-or">
          <button className="link-btn" onClick={onUseLocal}>
            Use without an account
          </button>
          <span className="hint">Your progress stays only in this browser, and the AI coach is off.</span>
        </div>
      </div>
      <p className="hint login-privacy">
        <a href="/privacy.html">Privacy: what Cramwise stores about you</a>
      </p>
    </section>
  );
}
