// Every exam is a boss. Its HP (health) = chapters you still have to do.
// Finishing a chapter "hits" the boss (and gives you 30 XP).
// Most dangerous boss first (highest urgency score).
import { useState } from "react";
import { urgencyBreakdown, urgencyLevel, WEIGHTS } from "../utils/urgency.js";
import { formatDay, formatTime, parseISODate, toISODate, daysBetween, hasDeadline } from "../utils/dates.js";
import { CHAPTER_XP } from "../utils/game.js";
import { nextTopic } from "../utils/subjects.js";

// Urgency label -> game difficulty name
export const THREAT = { Critical: "Nightmare", High: "Hard", Medium: "Normal", Low: "Easy" };

export default function Bosses({ subjects, onChapterChange, onToggleTopic, onEdit, onAdd, compact = false }) {
  const [openId, setOpenId] = useState(null);
  const [listId, setListId] = useState(null); // which boss has its chapter list open
  const today = toISODate(new Date());
  const withInfo = subjects.map((s) => ({ s, u: urgencyBreakdown(s), over: hasDeadline(s) && s.examDate < today }));
  // Subjects with a deadline come first (soonest first); "just learning" ones go last
  const dateKey = (s) => (hasDeadline(s) ? s.examDate : "9999");
  // Today tab: the single most dangerous boss whose exam hasn't happened yet.
  // Bosses tab: sorted by EXAM DATE (soonest first), not by urgency, so the cards
  // don't jump around under your mouse when "Chapter done" changes the urgency.
  const list = compact
    ? withInfo.filter((r) => !r.over).sort((a, b) => b.u.score - a.u.score).slice(0, 1)
    : [...withInfo].sort((a, b) => a.over - b.over || dateKey(a.s).localeCompare(dateKey(b.s)) || a.s.name.localeCompare(b.s.name));

  return (
    <div className={`bosses ${compact ? "is-compact" : ""}`}>
      {list.map(({ s, u, over }) => {
        const steady = !hasDeadline(s);
        const realDays = steady ? null : daysBetween(new Date(), parseISODate(s.examDate));
        const at = s.examTime ? ` at ${formatTime(s.examTime)}` : "";
        const lvl = urgencyLevel(u.score);
        const hpLeft = s.totalChapters - s.chaptersDone;
        const hpPct = (hpLeft / s.totalChapters) * 100;
        const defeated = hpLeft === 0;
        const open = openId === s.id;
        const pts = {
          deadline: Math.round(u.factors.deadline * WEIGHTS.deadline * 100),
          difficulty: Math.round(u.factors.difficulty * WEIGHTS.difficulty * 100),
          load: Math.round(u.factors.load * WEIGHTS.load * 100),
        };

        return (
          <article key={s.id} className={`boss ${defeated ? "is-defeated" : ""} ${over ? "is-over" : ""}`} style={{ "--ink": s.color, "--threat": lvl.color }}>
            <header className="boss-head">
              <div>
                <h3 className={`boss-name ${s.name.length > 14 ? "is-long" : ""}`}>{s.name}</h3>
                <p className="boss-when">
                  {steady
                    ? "No deadline: studied at a steady pace"
                    : realDays === 0
                      ? `Exam is today${at}. Good luck!`
                      : over
                        ? `Exam was on ${formatDay(parseISODate(s.examDate))}`
                        : `Exam ${formatDay(parseISODate(s.examDate))}${at}, in ${realDays} day${realDays === 1 ? "" : "s"}`}
                </p>
              </div>
              {onEdit && (
                <button className="edit-btn" onClick={() => onEdit(s)} aria-label={`Edit ${s.name}`}>
                  Edit
                </button>
              )}
              <div className="boss-days" aria-label={steady ? "No deadline" : realDays === 0 ? "Exam today" : over ? "Exam over" : `${realDays} days left`}>
                <span className="boss-days-num">{steady ? "∞" : realDays === 0 ? "!" : over ? "-" : realDays}</span>
                <span className="boss-days-label">{steady ? "steady" : realDays === 0 ? "today" : over ? "over" : "days"}</span>
              </div>
            </header>

            <div className="hp">
              <div className="hp-top">
                <span>{defeated ? "Defeated" : "Boss HP"}</span>
                <span>
                  {hpLeft} / {s.totalChapters} chapters left
                </span>
              </div>
              <div className="hp-bar" role="progressbar" aria-valuenow={hpLeft} aria-valuemin={0} aria-valuemax={s.totalChapters}>
                <div style={{ width: `${hpPct}%` }} />
              </div>
            </div>

            {nextTopic(s) && (
              <p className="boss-next">
                Next chapter: <b>{nextTopic(s)}</b>
              </p>
            )}

            <div className="boss-actions">
              <button className="btn btn-hit" onClick={() => onChapterChange(s.id, 1)} disabled={defeated}>
                Chapter done <span>+{CHAPTER_XP} XP</span>
              </button>
              <button
                className="btn btn-ghost btn-small"
                onClick={() => onChapterChange(s.id, -1)}
                disabled={s.chaptersDone === 0}
                aria-label={`Undo one ${s.name} chapter`}
              >
                Undo
              </button>
              <button className="threat" onClick={() => setOpenId(open ? null : s.id)} aria-expanded={open}>
                <span className="threat-name">{THREAT[lvl.label]}</span>
                <span className="threat-score">threat {u.score}</span>
              </button>
            </div>

            {s.topics?.length > 0 && !compact && (
              <div className="topics">
                <button className="link-btn" onClick={() => setListId(listId === s.id ? null : s.id)} aria-expanded={listId === s.id}>
                  {listId === s.id ? "Hide chapters" : `Show all ${s.topics.length} chapters`}
                </button>
                {listId === s.id && (
                  <ul className="topic-list">
                    {s.topics.map((t, i) => (
                      <li key={i}>
                        <label className={t.done ? "is-done" : ""}>
                          <input type="checkbox" checked={t.done} onChange={() => onToggleTopic(s.id, i)} />
                          <span>{t.name}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {open && (
              <p className="boss-why">
                Threat {u.score}/100. {steady ? "Having no deadline adds" : "The exam date adds"} <b>{pts.deadline}</b>, difficulty ({s.difficulty}/5) adds{" "}
                <b>{pts.difficulty}</b>, and chapter load adds <b>{pts.load}</b>. You need about{" "}
                {u.chaptersPerDay.toFixed(1)} chapters a day.
              </p>
            )}
          </article>
        );
      })}
      {onAdd && !compact && (
        <button className="boss-add" onClick={onAdd}>
          <span className="boss-add-plus" aria-hidden="true">+</span>
          Add a boss
          <small>New exam, subject or skill</small>
        </button>
      )}
    </div>
  );
}
