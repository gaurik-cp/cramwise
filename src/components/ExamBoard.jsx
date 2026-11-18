// Your exams (bosses) on an arcade LED scoreboard, soonest first.
// Status comes from the urgency score:
//   Critical -> DANGER,   High -> ATTACK,   Medium -> ON TRACK,   Low -> CHILL
//   all chapters done -> DEFEATED,   exam day -> TODAY,   exam over -> DONE
//   no deadline (just learning) -> STEADY, listed last
import { useEffect, useState } from "react";
import SplitFlap from "./SplitFlap.jsx";
import { urgencyBreakdown, urgencyLevel } from "../utils/urgency.js";
import { daysBetween, hasDeadline, parseISODate } from "../utils/dates.js";

const STATUS = {
  Critical: { text: "DANGER", tone: "red" },
  High: { text: "ATTACK", tone: "amber" },
  Medium: { text: "ON TRACK", tone: "paper" },
  Low: { text: "CHILL", tone: "green" },
};

// "2026-10-12" -> "12 OCT" (or "OCT 12" in the US: the person's own date style)
function boardDate(iso) {
  if (!iso) return "--";
  return parseISODate(iso)
    .toLocaleDateString(undefined, { day: "2-digit", month: "short" })
    .toUpperCase();
}

// A small clock in the corner, like real boards have
function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(t);
  }, []);
  return now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export default function ExamBoard({ subjects }) {
  const clock = useClock();

  const rows = subjects
    .map((s) => {
      const u = urgencyBreakdown(s);
      const steady = !hasDeadline(s);
      const realDays = steady ? null : daysBetween(new Date(), parseISODate(s.examDate));
      const over = !steady && realDays < 0;
      const status = steady
        ? u.chaptersLeft === 0
          ? { text: "DEFEATED", tone: "green" }
          : { text: "STEADY", tone: "paper" }
        : realDays === 0
        ? { text: "EXAM DAY", tone: "red" }
        : over
        ? { text: "DONE", tone: "dim" }
        : realDays === 0
          ? { text: "TODAY", tone: "red" }
        : u.chaptersLeft === 0
          ? { text: "DEFEATED", tone: "green" }
          : STATUS[urgencyLevel(u.score).label];
      return { s, u, realDays, over, status };
    })
    .sort((a, b) => (a.s.examDate || "9999").localeCompare(b.s.examDate || "9999"));

  return (
    <div className="board">
      <div className="board-top">
        <span className="board-title">Boss board</span>
        <span className="board-clock">{clock}</span>
      </div>

      <div className="board-grid" role="table" aria-label="Exam board">
        <div className="board-row board-head" role="row">
          <span role="columnheader">Boss</span>
          <span role="columnheader" className="col-date">Date</span>
          <span role="columnheader" className="col-num">Days</span>
          <span role="columnheader" className="col-num col-left">HP</span>
          <span role="columnheader">Status</span>
        </div>

        {rows.map(({ s, u, realDays, over, status }, i) => (
          <div className={`board-row ${over ? "is-over" : ""}`} role="row" key={s.id}>
            <span role="cell" className="cell-subject">
              <i className="board-ink" style={{ background: s.color }} />
              <SplitFlap text={s.name} size={10} delay={i * 2} />
            </span>
            <span role="cell" className="col-date">
              <SplitFlap text={boardDate(s.examDate)} size={6} delay={i * 2 + 2} />
            </span>
            <span role="cell" className="col-num">
              <SplitFlap text={realDays === null ? "--" : Math.max(0, realDays)} size={2} align="right" delay={i * 2 + 3} tone="yellow" />
            </span>
            <span role="cell" className="col-num col-left">
              <SplitFlap text={u.chaptersLeft} size={2} align="right" delay={i * 2 + 4} />
            </span>
            <span role="cell">
              <SplitFlap text={status.text} size={8} delay={i * 2 + 4} tone={status.tone} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
