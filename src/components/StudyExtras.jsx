// Two small panels for the Today tab:
//   ExamWeek   shows up when an exam is 1-3 days away: revision only,
//              your weak chapters (from quiz scores), quick quiz + cards
//   Revisions  chapters you finished 1, 3 or 7 days ago, as short quests
import { REVISION_XP, weakChapters } from "../utils/game.js";

export function ExamWeek({ items, progress, dueCardCount, onQuiz, onCards }) {
  if (items.length === 0) return null;
  return (
    <div className="exam-week">
      {items.map(({ s, days }) => {
        const weak = weakChapters(progress, s);
        return (
          <div key={s.id} className="exam-week-card" style={{ "--ink": s.color }}>
            <p className="exam-week-title">
              Exam week: <b>{s.name}</b> in {days} day{days === 1 ? "" : "s"}
            </p>
            <p className="muted">Revision only now. No new chapters: go over what you know and fix your weak spots.</p>
            {weak.length > 0 && (
              <div className="weak">
                <span className="weak-label">Weak chapters</span>
                <ul>
                  {weak.map((w) => (
                    <li key={w.name}>
                      {w.name}
                      <em>{w.pct === null ? "not tested yet" : `${w.pct}% in quizzes`}</em>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="exam-week-actions">
              <button className="btn btn-primary btn-small" onClick={() => onQuiz(s.id, weak[0]?.name ?? "")}>
                Quick quiz{weak[0] ? `: ${weak[0].name}` : ""}
              </button>
              {dueCardCount > 0 && (
                <button className="btn btn-ghost btn-small" onClick={onCards}>
                  Review {dueCardCount} cards
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function Revisions({ items, onDone }) {
  if (items.length === 0) return null;
  return (
    <div className="revisions">
      <p className="revisions-title">
        Quick revisions <span className="muted">(about 15 min each, +{REVISION_XP} XP)</span>
      </p>
      <ul>
        {items.map((r) => (
          <li key={r.key} style={{ "--ink": r.subject.color }}>
            <button className="quest-check small-check" role="checkbox" aria-checked={false} aria-label={`Revised ${r.name}`} onClick={() => onDone(r)}>
              <span className="tick" aria-hidden="true" />
            </button>
            <div className="rev-body">
              <span className="rev-name">{r.name}</span>
              <span className="rev-meta">
                {r.subject.name}, finished {r.step === 1 ? "yesterday" : `${r.step} days ago`} (round {[1, 3, 7].indexOf(r.step) + 1} of 3)
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
