// Friends: share your friend code, add friends by theirs, and compete on a
// weekly XP leaderboard. "Together" = days in a row you BOTH studied.
// Friends only ever see your first name, level, weekly XP and streaks.
import { useCallback, useEffect, useState } from "react";
import { api } from "../utils/api.js";
import { toISODate } from "../utils/dates.js";

export default function Friends({ signedIn, xpVersion }) {
  const [data, setData] = useState(null); // { code, people: [...] }
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api(`/api/friends?today=${toISODate(new Date())}`));
    } catch (e) {
      setError(e.message);
    }
  }, []);

  // Reload when your XP changes (after a short pause, so the save reaches the server first)
  useEffect(() => {
    if (!signedIn) return;
    const t = setTimeout(load, 1500);
    return () => clearTimeout(t);
  }, [signedIn, load, xpVersion]);

  if (!signedIn) {
    return (
      <div className="friends ai-off">
        <p className="ai-off-title">Friends</p>
        <p>Sign in to add friends, see a weekly XP leaderboard and keep streaks together.</p>
      </div>
    );
  }

  async function add(e) {
    e.preventDefault();
    setError("");
    setMsg("");
    try {
      const { name } = await api("/api/friends", { method: "POST", json: { code } });
      setMsg(`You and ${name} are now friends.`);
      setCode("");
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(p) {
    if (!window.confirm(`Remove ${p.name} from your friends?`)) return;
    await api(`/api/friends/${p.id}`, { method: "DELETE" }).catch(() => {});
    load();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(data.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: the code is on screen anyway */
    }
  }

  return (
    <div className="friends chart-card">
      <div className="friends-head">
        <div>
          <h3 className="chart-title">Friends leaderboard</h3>
          <p className="muted">XP earned in the last 7 days. Resets as the week moves on.</p>
        </div>
        {data && (
          <div className="my-code">
            <span className="muted">Your friend code</span>
            <button className="code-chip" onClick={copy} title="Copy">
              {data.code}
            </button>
            <small className="muted">{copied ? "Copied!" : "Tap to copy, then send it to friends"}</small>
          </div>
        )}
      </div>

      {data && (
        <ol className="board-list">
          {data.people.map((p, i) => (
            <li key={p.id} className={p.you ? "is-you" : ""}>
              <span className="rank">{i + 1}</span>
              <span className="who-name">
                {p.name}
                {p.you && <em> (you)</em>}
                <small>Level {p.level}</small>
              </span>
              <span className="lb-stat">
                <b>{p.weekXp}</b> XP
              </span>
              <span className="lb-stat">
                <b>{p.streak}</b> day streak
              </span>
              {p.you ? (
                <span />
              ) : (
                <span className="lb-stat together" title="Days in a row you both studied">
                  <b>{p.sharedStreak}</b> together
                </span>
              )}
              {!p.you && (
                <button className="link-btn" onClick={() => remove(p)}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
      {data?.people.length === 1 && <p className="muted">No friends yet. Add one with their code below.</p>}

      <form className="add-friend" onSubmit={add}>
        <input className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Friend's code, e.g. K7MPQ2XR" maxLength={12} aria-label="Friend code" />
        <button className="btn btn-primary" disabled={!code.trim()}>
          Add friend
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      {msg && !error && <p className="ok-note">{msg}</p>}
    </div>
  );
}
