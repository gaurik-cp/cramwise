// Focus timer: a countdown docked at the bottom of the screen.
//   FOCUS phase: counts down the session. At 0 -> ding, notification,
//                the quest is ticked off automatically (+XP), break starts.
//   BREAK phase: counts down the break. At 0 -> ding, "back to work".
// The end time is saved on this device, so refreshing the page doesn't lose it.
import { useEffect, useState } from "react";
import { beep, notify, setSetting } from "../utils/alerts.js";

export const TIMER_KEY = "cramwise-timer";

function fmt(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// timer = { date, session, topic, phase: "focus"|"break", endsAt, pausedLeft, totalMs }
export default function FocusTimer({ timer, setTimer, breakMinutes, onComplete }) {
  const [now, setNow] = useState(Date.now());

  // Tick 4 times a second (smooth enough, cheap enough)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  // Remember the timer on this device
  useEffect(() => {
    setSetting(TIMER_KEY, timer);
  }, [timer]);

  const left = timer.pausedLeft ?? timer.endsAt - now;

  // Time's up?
  useEffect(() => {
    if (timer.pausedLeft != null || left > 0) return;
    if (timer.phase === "focus") {
      beep([660, 880, 1320]);
      notify("Quest complete!", `${timer.session.subjectName} done. Take a ${breakMinutes}-minute break.`);
      onComplete(timer.date, timer.session);
      if (breakMinutes > 0) {
        setTimer({ ...timer, phase: "break", endsAt: Date.now() + breakMinutes * 60000, totalMs: breakMinutes * 60000, pausedLeft: null });
      } else {
        setTimer(null);
      }
    } else {
      beep([880, 660]);
      notify("Break's over", "Back to your quests.");
      setTimer(null);
    }
  }, [left, timer, breakMinutes, onComplete, setTimer]);

  const pct = Math.min(100, Math.max(0, 100 - (left / timer.totalMs) * 100));
  const paused = timer.pausedLeft != null;
  const isFocus = timer.phase === "focus";

  return (
    <div className={`timer-dock ${isFocus ? "is-focus" : "is-break"}`} role="timer" aria-live="off">
      <div className="timer-bar" style={{ width: `${pct}%` }} />
      <div className="timer-inner">
        <div className="timer-info">
          <span className="timer-phase">{isFocus ? "Focus" : "Break"}</span>
          <span className="timer-what">
            {isFocus ? timer.session.subjectName : "Stretch, drink water, look away from the screen"}
            {isFocus && timer.topic && <em>: {timer.topic}</em>}
          </span>
        </div>
        <span className="timer-clock">{fmt(left)}</span>
        <div className="timer-actions">
          <button
            className="btn btn-ghost btn-small"
            onClick={() =>
              setTimer(paused ? { ...timer, endsAt: Date.now() + timer.pausedLeft, pausedLeft: null } : { ...timer, pausedLeft: left })
            }
          >
            {paused ? "Resume" : "Pause"}
          </button>
          {isFocus ? (
            <>
              <button
                className="btn btn-primary btn-small"
                onClick={() => setTimer({ ...timer, endsAt: Date.now(), pausedLeft: null })}
                title="Finished early? Count it as done"
              >
                Done
              </button>
              <button className="link-btn" onClick={() => setTimer(null)}>
                Stop
              </button>
            </>
          ) : (
            <button className="btn btn-primary btn-small" onClick={() => setTimer(null)}>
              Skip break
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
