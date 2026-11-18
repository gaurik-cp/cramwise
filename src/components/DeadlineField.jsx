// "When's the exam?" with a choice for people who aren't studying for one.
//   Has a date      -> date (+ optional time)
//   No deadline     -> examDate "" (just learning, studied at a steady pace)
// Used by the setup screen and the boss editor.
import { addDays, toISODate } from "../utils/dates.js";

export default function DeadlineField({ examDate, examTime = "", onChange }) {
  const steady = !examDate;
  return (
    <div className="field span-all deadline-field">
      <span>Exam or deadline</span>
      <div className="seg" role="radiogroup" aria-label="Deadline">
        <button
          type="button"
          role="radio"
          aria-checked={!steady}
          className={!steady ? "on" : ""}
          onClick={() => steady && onChange({ examDate: toISODate(addDays(new Date(), 14)), examTime })}
        >
          Has a date
        </button>
        <button type="button" role="radio" aria-checked={steady} className={steady ? "on" : ""} onClick={() => onChange({ examDate: "", examTime: "" })}>
          No deadline
        </button>
      </div>
      {steady ? (
        <small className="field-hint">Just learning (e.g. a language, coding, an instrument). It gets steady study time every week.</small>
      ) : (
        <div className="deadline-row">
          <input type="date" className="input" aria-label="Exam or deadline date" value={examDate} onChange={(e) => onChange({ examDate: e.target.value, examTime })} />
          <input
            type="time"
            className="input"
            aria-label="Time (optional)"
            title="Time (optional)"
            value={examTime}
            onChange={(e) => onChange({ examDate, examTime: e.target.value })}
          />
        </div>
      )}
    </div>
  );
}
