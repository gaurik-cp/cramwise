// Today's quests = today's study sessions. Tick one to earn XP.
import { useState } from "react";
import { isDone, questXp, weakChapters } from "../utils/game.js";
import { nextTopic } from "../utils/subjects.js";
import { formatDay, formatTime, parseISODate } from "../utils/dates.js";
import { timeToMinutes } from "../utils/dates.js";

// Each session can carry its own `_date` (late-night sessions from yesterday);
// otherwise it belongs to `date` (today).
export default function Quests({ date, sessions, busy, subjects, progress, onToggle, isRest, onStart, activeKey, missed = [], onMakeUp, onSkip }) {
  const [pops, setPops] = useState({}); // little "+50 XP" pop-ups, by quest start time

  const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
  const dateOf = (s) => s._date ?? date;
  const doneCount = sessions.filter((s) => isDone(progress, dateOf(s), s)).length;
  const xpToday = sessions.filter((s) => isDone(progress, dateOf(s), s)).reduce((n, s) => n + questXp(s, subjects.find((x) => x.id === s.subjectId)), 0);

  function toggle(session, subject) {
    const { _date, ...plain } = session;
    const d = _date ?? date;
    const wasDone = isDone(progress, d, plain);
    onToggle(d, plain);
    if (!wasDone) {
      const xp = questXp(session, subject);
      setPops((p) => ({ ...p, [session.start]: xp }));
      setTimeout(() => setPops((p) => ({ ...p, [session.start]: undefined })), 1100);
    }
  }

  const missedBlock = missed.length > 0 && (
    <details className="missed">
      <summary>
        {missed.length} missed quest{missed.length === 1 ? "" : "s"} from the last few days
      </summary>
      <p className="muted missed-sub">Did it later anyway? Mark it done for the XP. Otherwise skip it.</p>
      <ul>
        {missed.map(({ date: d, session: m, key }) => (
          <li key={key} style={{ "--ink": m.color }}>
            <span className="missed-name">{m.subjectName}</span>
            <span className="missed-when">
              {formatDay(parseISODate(d))}, {formatTime(m.start)}
            </span>
            <button className="btn btn-ghost btn-small" onClick={() => onMakeUp(d, m)}>
              I did it
            </button>
            <button className="link-btn" onClick={() => onSkip(key)}>
              Skip
            </button>
          </li>
        ))}
      </ul>
    </details>
  );

  if (isRest || sessions.length === 0) {
    return (
      <>
      <div className="quests-empty">
        <p className="quests-empty-title">{isRest ? "Rest day" : "No quests today"}</p>
        <p className="muted">
          {isRest
            ? "Recharge. Your streak is safe if you studied yesterday and study tomorrow."
            : "Your day is full with fixed things. Check the Week tab."}
        </p>
      </div>
      {missedBlock}
      </>
    );
  }

  // The next fixed thing (class/meal) coming up today, for context
  const nextFixed = busy.find((b) => timeToMinutes(b.start) > nowMins);

  return (
    <div className="quests">
      <div className="quests-head">
        <p>
          <b>
            {doneCount}/{sessions.length}
          </b>{" "}
          done today, <b className="xp-text">+{xpToday} XP</b> earned
        </p>
        {nextFixed && (
          <p className="muted">
            Next fixed: {nextFixed.label} at {formatTime(nextFixed.start)}
          </p>
        )}
      </div>

      <div className="quest-progress" aria-hidden="true">
        {sessions.map((s) => (
          <i key={dateOf(s) + s.start} className={isDone(progress, dateOf(s), s) ? "on" : ""} style={{ "--ink": s.color }} />
        ))}
      </div>

      <ul className="quest-list">
        {sessions.map((s) => {
          const subject = subjects.find((x) => x.id === s.subjectId);
          const done = isDone(progress, dateOf(s), s);
          // minutes since today's midnight (yesterday's late sessions are 1440 lower)
          const offset = dateOf(s) !== date ? 1440 : 0;
          const st = (s.startMin ?? timeToMinutes(s.start)) - offset;
          const en = (s.endMin ?? timeToMinutes(s.end)) - offset;
          const live = st <= nowMins && nowMins < en;
          const key = `${dateOf(s)}|${s.start}`;
          return (
            <li key={key} className={`quest ${done ? "is-done" : ""} ${live ? "is-live" : ""}`} style={{ "--ink": s.color }}>
              <button
                className="quest-check"
                role="checkbox"
                aria-checked={done}
                aria-label={`${s.subjectName} at ${s.start}${done ? ", done" : ""}`}
                onClick={() => toggle(s, subject)}
              >
                <span className="tick" aria-hidden="true" />
              </button>
              <div className="quest-body">
                {subject && !done && (s.type === "Revision" ? (
                  <span className="quest-topic">Revise{weakChapters(progress, subject)[0] ? `: ${weakChapters(progress, subject)[0].name}` : " what you've done"}</span>
                ) : (
                  nextTopic(subject) && <span className="quest-topic">{nextTopic(subject)}</span>
                ))}
                <span className="quest-name">
                  {s.subjectName}
                  {s.type === "Revision" && <em className="tag-rev">Revision</em>}
                  {live && !done && <em className="tag-live">Now</em>}
                </span>
                <span className="quest-time">
                  {formatTime(s.start)}–{formatTime(s.end)}
                </span>
              </div>
              <div className="quest-side">
                <span className="quest-xp">+{questXp(s, subject)} XP</span>
                {!done && onStart && (
                  <button className="btn btn-primary btn-small start-btn" onClick={() => onStart(s)} disabled={activeKey === key}>
                    {activeKey === key ? "Running" : "Start"}
                  </button>
                )}
              </div>
              {pops[s.start] && <span className="xp-pop">+{pops[s.start]} XP</span>}
              {offset > 0 && <span className="carry-tag">From last night</span>}
            </li>
          );
        })}
      </ul>
      {missedBlock}
    </div>
  );
}
