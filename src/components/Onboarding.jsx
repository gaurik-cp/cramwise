// Setup in 3 steps:
//   1. You        your name
//   2. Bosses     your exams (subjects, dates, chapters)
//   3. Your week  classes/labs/meals + when and how long you study
import { useState } from "react";
import { addDays, toISODate, formatDay, parseISODate } from "../utils/dates.js";
import { inkFor } from "../utils/colors.js";
import DeadlineField from "./DeadlineField.jsx";
import WeekEditor from "./WeekEditor.jsx";
import StudyImport from "./StudyImport.jsx";
import { syncCounts } from "../utils/subjects.js";
import { normalizePrefs } from "../utils/scheduler.js";
import { readPlanFile } from "../utils/planFile.js";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ORDER = [1, 2, 3, 4, 5, 6, 0];
const STEPS = ["You", "Bosses", "Your week"];

function emptySubject() {
  // Difficulty starts empty on purpose: only the student knows how hard it is for them
  return { name: "", difficulty: null, examDate: toISODate(addDays(new Date(), 14)), totalChapters: 8, chaptersDone: 0 };
}

export default function Onboarding({ initial, onFinish, onImportPlan, aiState }) {
  // Already have a name (e.g. you deleted all your subjects)? Skip straight to step 2
  const [step, setStep] = useState(initial?.userName && !initial?.subjects?.length ? 1 : 0);
  const [userName, setUserName] = useState(initial?.userName ?? "");
  const [subjects, setSubjects] = useState(initial?.subjects ?? []);
  const [draft, setDraft] = useState(emptySubject());
  const [prefs, setPrefs] = useState(() =>
    normalizePrefs(
      initial?.prefs ?? {
        hoursPerDay: 4,
        dayStart: "07:00",
        dayEnd: "22:30",
        sessionLength: 50,
        breakLength: 10,
        restDays: [0],
        planDays: 14,
        busy: [],
      }
    )
  );
  const [error, setError] = useState("");
  const [syllabusOpen, setSyllabusOpen] = useState(false);

  function addSubject() {
    if (!draft.name.trim()) return setError("Type the subject name first.");
    if (!draft.difficulty) return setError("Pick how hard this subject is for you (1 to 5).");
    if (subjects.some((s) => s.name.toLowerCase() === draft.name.trim().toLowerCase()))
      return setError(`You already added ${draft.name.trim()}. Remove it first if you want to change it.`);
    if (!Number.isInteger(Number(draft.totalChapters)) || !Number.isInteger(Number(draft.chaptersDone)))
      return setError("Chapters must be whole numbers (no decimals).");
    if (Number(draft.chaptersDone) < 0) return setError("Chapters done can't be negative.");
    if (Number(draft.totalChapters) < 1) return setError("A subject needs at least 1 chapter.");
    if (Number(draft.chaptersDone) > Number(draft.totalChapters))
      return setError("Chapters done can't be more than total chapters.");
    if (draft.examDate && draft.examDate <= toISODate(new Date())) return setError("Pick an exam date after today (or choose No deadline).");
    setSubjects([
      ...subjects,
      {
        ...draft,
        name: draft.name.trim(),
        examTime: draft.examDate && draft.examTime ? draft.examTime : undefined,
        id: crypto.randomUUID(),
        difficulty: Number(draft.difficulty),
        totalChapters: Number(draft.totalChapters),
        chaptersDone: Number(draft.chaptersDone),
        color: inkFor(subjects.length),
      },
    ]);
    setDraft(emptySubject());
    setError("");
  }

  function toggleRestDay(d) {
    const restDays = prefs.restDays.includes(d) ? prefs.restDays.filter((x) => x !== d) : [...prefs.restDays, d];
    if (restDays.length === 7) return;
    setPrefs({ ...prefs, restDays });
  }

  function next() {
    if (step === 0 && !userName.trim()) return setError("Type your name to continue.");
    if (step === 1 && subjects.length === 0) return setError("Add at least one exam to continue.");
    if (step === 2) {
      if (!prefs.dayStart || !prefs.dayEnd) return setError("Fill in both the earliest start and latest finish times.");
      if (prefs.dayStart === prefs.dayEnd) return setError("Earliest start and latest finish can't be the same time.");
      if (!(Number(prefs.breakLength) >= 0) || Number(prefs.breakLength) > 120) return setError("Breaks must be between 0 and 120 minutes.");
      if (Number(prefs.sessionLength) > 240) return setError("Sessions can be at most 240 minutes (4 hours).");
      if (!(Number(prefs.planDays) >= 1 && Number(prefs.planDays) <= 60)) return setError("Plan ahead must be between 1 and 60 days.");
      if (prefs.hoursPerDay < 1 || prefs.hoursPerDay > 14) return setError("Study hours a day must be between 1 and 14.");
      if (!(Number(prefs.sessionLength) >= 15)) return setError("Sessions must be at least 15 minutes.");
      return onFinish({ userName: userName.trim(), subjects, prefs });
    }
    setError("");
    setStep(step + 1);
  }

  // Changing a setting clears the old error message (it may be fixed now)
  const set = (k) => (e) => {
    setError("");
    setPrefs({ ...prefs, [k]: e.target.type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value });
  };

  return (
    <section className={`setup ${step === 2 ? "setup-wide" : ""}`}>
      <ol className="tracker">
        {STEPS.map((label, i) => (
          <li key={label} className={i === step ? "now" : i < step ? "past" : ""}>
            <button onClick={() => i < step && setStep(i)} disabled={i > step}>
              <span className="tracker-num">{i + 1}</span>
              {label}
            </button>
          </li>
        ))}
      </ol>

      <div className="setup-body" key={step}>
        {step === 0 && (
          <>
            <h1 className="setup-title">Create your player</h1>
            <p className="lead">Cramwise turns exam prep into a game. Study sessions are quests, exams are bosses.</p>
            <label className="field big-field">
              <span>Your name</span>
              <input
                className="input input-big"
                placeholder="e.g. Gauri"
                value={userName}
                autoFocus
                onChange={(e) => setUserName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && next()}
              />
            </label>
            <p className="small-links">
              Have a backup file?{" "}
              <label className="link-btn file-link">
                Load it
                <input
                  type="file"
                  accept=".json,application/json"
                  hidden
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    try {
                      const r = await readPlanFile(file);
                      if (r.kind === "plan") onImportPlan(r.data);
                      else setPrefs({ ...prefs, busy: [...prefs.busy, ...r.busy] });
                    } catch (err) {
                      setError(err.message);
                    }
                  }}
                />
              </label>
            </p>
          </>
        )}

        {step === 1 && (
          <>
            <h1 className="setup-title">Add your bosses</h1>
            <p className="lead">
              One per exam, or per thing you're learning without a deadline. Count only the chapters you need to cover.
            </p>
            <button className="import-cta" onClick={() => setSyllabusOpen(true)}>
              <span className="import-cta-title">Got your exam timetable or syllabus?</span>
              <span className="import-cta-sub">Upload one or both. The AI fills in your subjects, exam dates and chapters, and you check them before anything is added.</span>
            </button>
            <p className="muted small-gap">Or add them by hand:</p>

            <div className="boss-form">
              <label className="field f-name">
                <span>Subject</span>
                <input
                  className="input"
                  placeholder="e.g. Calculus, Biology, Learn Spanish"
                  value={draft.name}
                  autoFocus
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && addSubject()}
                />
              </label>
              <label className="field">
                <span>Chapters</span>
                <input type="number" min="1" className="input" value={draft.totalChapters} onChange={(e) => setDraft({ ...draft, totalChapters: e.target.value })} />
              </label>
              <label className="field">
                <span>Already done</span>
                <input type="number" min="0" className="input" value={draft.chaptersDone} onChange={(e) => setDraft({ ...draft, chaptersDone: e.target.value })} />
              </label>
              <DeadlineField examDate={draft.examDate} examTime={draft.examTime ?? ""} onChange={(v) => setDraft({ ...draft, ...v })} />
              <div className="field f-diff">
                <span>How hard is this for you? (1 easy, 5 brutal)</span>
                <div className="scale" role="radiogroup" aria-label="Difficulty">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      role="radio"
                      aria-checked={draft.difficulty === n}
                      className={draft.difficulty === n ? "on" : ""}
                      onClick={() => setDraft({ ...draft, difficulty: n })}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <button className="btn btn-primary f-add" onClick={addSubject}>
                Add boss
              </button>
            </div>

            {subjects.length > 0 && (
              <ul className="boss-chips">
                {subjects.map((s) => (
                  <li key={s.id} style={{ "--ink": s.color }}>
                    <b>{s.name}</b>
                    <span>
                      {s.examDate ? formatDay(parseISODate(s.examDate)) : "No deadline"}, {s.totalChapters - s.chaptersDone} ch left, difficulty {s.difficulty}
                    </span>
                    <button className="chip-x" onClick={() => setSubjects(subjects.filter((x) => x.id !== s.id))} aria-label={`Remove ${s.name}`}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {step === 2 && (
          <>
            <h1 className="setup-title">Your week</h1>
            <p className="lead">Add classes, work, meals and other fixed plans so quests only land in your free time. You can skip this and add it later.</p>

            <WeekEditor
              busy={prefs.busy}
              setBusy={(busy) => setPrefs({ ...prefs, busy })}
              dayStart={prefs.dayStart}
              dayEnd={prefs.dayEnd}
              aiState={aiState}
              batchHint={prefs.batchHint ?? ""}
              setBatchHint={(batchHint) => setPrefs({ ...prefs, batchHint })}
              subjects={subjects}
            />

            <details className="study-settings" open={!initial?.prefs}>
              <summary>Study settings</summary>
              <div className="settings-grid">
                <label className="field">
                  <span>Study hours a day</span>
                  <input type="number" min="1" max="14" className="input" value={prefs.hoursPerDay} onChange={set("hoursPerDay")} />
                </label>
                <label className="field">
                  <span>Earliest start</span>
                  <input type="time" className="input" value={prefs.dayStart} onChange={set("dayStart")} />
                </label>
                <label className="field">
                  <span>Latest finish</span>
                  <input type="time" className="input" value={prefs.dayEnd} onChange={set("dayEnd")} />
                  {prefs.dayEnd < prefs.dayStart && <small className="field-hint">Past midnight (into the next day)</small>}
                </label>
                <label className="field">
                  <span>Session (min)</span>
                  <input type="number" min="15" step="5" className="input" value={prefs.sessionLength} onChange={set("sessionLength")} />
                </label>
                <label className="field">
                  <span>Break (min)</span>
                  <input type="number" min="0" step="5" className="input" value={prefs.breakLength} onChange={set("breakLength")} />
                </label>
                <label className="field">
                  <span>Plan ahead (days)</span>
                  <input type="number" min="1" max="60" className="input" value={prefs.planDays} onChange={set("planDays")} />
                </label>
                <div className="field span-all">
                  <span>Rest days</span>
                  <div className="days">
                    {ORDER.map((i) => (
                      <button key={i} aria-pressed={prefs.restDays.includes(i)} className={prefs.restDays.includes(i) ? "on-solid" : ""} onClick={() => toggleRestDay(i)}>
                        {WEEKDAYS[i]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </details>
          </>
        )}
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {syllabusOpen && (
        <StudyImport
          existing={subjects}
          aiState={aiState}
          onApply={(list) => {
            const byId = new Map(subjects.map((s) => [s.id, s]));
            list.forEach((s) => byId.set(s.id, syncCounts(s)));
            setSubjects([...byId.values()]);
            setError("");
          }}
          onClose={() => setSyllabusOpen(false)}
        />
      )}

      <div className="setup-nav">
        {step > 0 ? (
          <button className="btn btn-ghost" onClick={() => setStep(step - 1)}>
            Back
          </button>
        ) : (
          <span />
        )}
        <button className="btn btn-primary btn-big" onClick={next}>
          {step === 2 ? (initial?.prefs ? "Save changes" : "Start playing") : "Next"}
        </button>
      </div>
    </section>
  );
}
