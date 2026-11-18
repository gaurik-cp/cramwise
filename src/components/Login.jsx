// Sign-in screen: Google button, or use the app without an account.
import { useEffect, useRef, useState } from "react";
import InstallButton from "./InstallButton.jsx";
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
    <section className="landing">
      <div className="landing-top">
        <div className="landing-copy">
          <p className="landing-eyebrow">Study planner game</p>
          <h1 className="landing-title">
            Turn exam prep <span>into a game.</span>
          </h1>
          <p className="lead">
            Upload your exam timetable and syllabus, and Cramwise turns them into daily study quests that fit around your
            classes and meals. Exams are bosses, chapters are their HP, and every session earns XP.
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
          <InstallButton className="btn btn-ghost landing-install" label="Install the app" />
          <p className="landing-facts">
            <span>Free</span>
            <span>Works on your phone</span>
            <span>Any subject, any country</span>
          </p>
        </div>

        <Preview />
      </div>

      <ul className="landing-features">
        {FEATURES.map((f) => (
          <li key={f.title} style={{ "--ink": f.ink }}>
            <span className="feature-tag">{f.tag}</span>
            <h2>{f.title}</h2>
            <p>{f.text}</p>
          </li>
        ))}
      </ul>

      <ol className="landing-steps">
        {STEPS.map((t, i) => (
          <li key={t.title}>
            <span className="step-num">{i + 1}</span>
            <div>
              <h3>{t.title}</h3>
              <p>{t.text}</p>
            </div>
          </li>
        ))}
      </ol>

      <p className="hint login-privacy">
        <a href="/privacy.html">Privacy: what Cramwise stores about you</a>
      </p>
    </section>
  );
}

const FEATURES = [
  { tag: "Quests", title: "A plan for every day", ink: "var(--xp)", text: "Study sessions are planned in your free time, around classes, meals and rest days. Tick them off for XP." },
  { tag: "Bosses", title: "Exams you can beat", ink: "var(--hp)", text: "Each exam is a boss with a countdown. Finish chapters to drain its HP. No exam? Study at a steady pace." },
  { tag: "AI coach", title: "Hard questions, fast", ink: "var(--mana)", text: "Medium-to-hard quizzes (MCQ or written), flashcards that come back when you forget, and AI marking." },
  { tag: "Friends", title: "Keep each other going", ink: "var(--pink)", text: "Weekly XP leaderboard, shared streaks and 35 trophies to unlock." },
];

const STEPS = [
  { title: "Upload", text: "Your exam timetable and syllabus (PDF or photo). Check what the AI found." },
  { title: "Get quests", text: "Rate how hard each subject is for you. Cramwise plans every day around your week." },
  { title: "Level up", text: "Study, tick quests, revise on time, and watch the bosses fall before exam day." },
];

// A static peek at the game (not interactive): the XP bar, a boss and today's quests
function Preview() {
  return (
    <div className="landing-preview" aria-hidden="true">
      <div className="pv-card pv-hud">
        <span className="pv-avatar">G</span>
        <div className="pv-grow">
          <p className="pv-name">
            Level 6 <small>420 / 600 XP</small>
          </p>
          <div className="pv-xp">
            <i style={{ width: "70%" }} />
          </div>
        </div>
        <div className="pv-stat">
          <b>12</b>
          <small>day streak</small>
        </div>
      </div>

      <div className="pv-card pv-boss" style={{ "--ink": "var(--pink)" }}>
        <div className="pv-boss-head">
          <div>
            <p className="pv-boss-name">Calculus II</p>
            <p className="pv-muted">Exam Mon 21 Dec, 9:30</p>
          </div>
          <div className="pv-days">
            <b>6</b>
            <small>days</small>
          </div>
        </div>
        <p className="pv-label">
          Boss HP <span>3 / 8 chapters left</span>
        </p>
        <div className="pv-hp">
          <i style={{ width: "37%" }} />
        </div>
      </div>

      <div className="pv-card pv-quests">
        <p className="pv-label">Today's quests</p>
        {[
          { t: "Integration by parts", s: "Calculus II", time: "5:30 PM", ink: "var(--pink)", done: true },
          { t: "Normalization", s: "Databases", time: "6:30 PM", ink: "var(--mana)", done: false, now: true },
          { t: "Revise: Greedy algorithms", s: "Algorithms", time: "9:00 PM", ink: "var(--gold)", done: false },
        ].map((q) => (
          <div key={q.t} className={`pv-quest ${q.done ? "is-done" : ""} ${q.now ? "is-now" : ""}`} style={{ "--ink": q.ink }}>
            <span className="pv-check" />
            <div className="pv-grow">
              <p className="pv-q">{q.t}</p>
              <p className="pv-muted">
                {q.s}, {q.time}
              </p>
            </div>
            <span className="pv-xp-tag">+30 XP</span>
          </div>
        ))}
      </div>
    </div>
  );
}
