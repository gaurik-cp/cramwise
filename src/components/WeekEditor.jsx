// "Your week" setup step: add the fixed things in your week
// (classes, labs, work, meals...) so study sessions never clash with them.
import { useRef, useState } from "react";
import { formatTime, timeToMinutes } from "../utils/dates.js";
import { readPlanFile } from "../utils/planFile.js";
import { api } from "../utils/api.js";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ORDER = [1, 2, 3, 4, 5, 6, 0]; // show Monday first, like a college timetable
const KIND_LABEL = { class: "Class", lab: "Lab", meal: "Meal", other: "Other" };

const emptyBlock = () => ({ label: "", kind: "class", days: [], start: "09:00", end: "10:00" });

const AI_OFF_TEXT = {
  signin: "Reading it automatically needs an account (AI is off without one). For now, copy it into the form below while looking at it.",
  noserver: "The Cramwise server isn't running, so the AI can't read it. Copy it into the form below while looking at it.",
  nokey: "The AI can't read it yet: there's no Gemini API key in server/.env (see SETUP-ONLINE.md). For now, copy it into the form below while looking at it.",
};

export default function WeekEditor({ busy, setBusy, dayStart, dayEnd, aiState, batchHint = "", setBatchHint = () => {}, subjects = [] }) {
  const aiOn = aiState === "on";
  const [dragging, setDragging] = useState(false);
  const [info, setInfo] = useState(""); // neutral explanations (e.g. why AI is off)
  const [draft, setDraft] = useState(emptyBlock());
  const [error, setError] = useState(""); // problems with the uploaded file / AI
  const [formError, setFormError] = useState(""); // problems with the "add by hand" form
  const [note, setNote] = useState("");
  const [reference, setReference] = useState(null); // { url, type, name, file } of an uploaded timetable
  const [reading, setReading] = useState(false);
  const importRef = useRef(null);

  function toggleDay(d) {
    const days = draft.days.includes(d) ? draft.days.filter((x) => x !== d) : [...draft.days, d];
    setDraft({ ...draft, days });
  }

  function addBlock() {
    if (!draft.label.trim()) return setFormError("Give it a name, like \"DAA lecture\" or \"Lunch\".");
    if (draft.days.length === 0) return setFormError("Pick at least one day.");
    if (!draft.start || !draft.end) return setFormError("Fill in both times.");
    if (draft.start >= draft.end) return setFormError("The end time has to be after the start time.");
    setBusy([...busy, { ...draft, label: draft.label.trim(), id: crypto.randomUUID() }]);
    // keep kind + days so adding the next lecture on the same days is quick
    setDraft({ ...emptyBlock(), kind: draft.kind, days: draft.days, start: draft.end, end: addHour(draft.end) });
    setFormError("");
  }

  function removeBlock(id) {
    setBusy(busy.filter((b) => b.id !== id));
  }

  // A timetable photo/PDF was chosen (or dropped): show it, and if the AI
  // is on, start reading it straight away.
  function pickFile(file) {
    if (!file) return;
    if (!/^image\/|^application\/pdf$/.test(file.type)) {
      setError("That's not a photo or PDF. Use a PNG, JPG, or PDF of your timetable.");
      return;
    }
    if (reference) URL.revokeObjectURL(reference.url);
    const ref = { url: URL.createObjectURL(file), type: file.type, name: file.name, file };
    setReference(ref);
    setError("");
    setNote("");
    setInfo(aiOn ? "" : AI_OFF_TEXT[aiState]);
    // A PDF often holds EVERY batch's timetable. Without knowing yours, the AI
    // would mix them up, so we wait for the batch box to be filled in first.
    if (aiOn && file.type === "application/pdf" && !batchHint.trim()) {
      setInfo("This PDF may have timetables for many batches. Type your batch in the box above, then press Read my timetable.");
      return;
    }
    if (aiOn) readWithAI(file);
  }

  function onReference(e) {
    pickFile(e.target.files?.[0]);
    e.target.value = "";
  }

  // Send the picture to our server, which asks the AI to read the timetable
  async function readWithAI(file = reference?.file) {
    if (!file) return;
    setReading(true);
    setError("");
    setNote("");
    try {
      const form = new FormData();
      form.append("file", file);
      if (batchHint.trim()) form.append("hint", batchHint.trim());
      // Your subjects, so "CS301" on the timetable is labelled the way you named it (e.g. "DBMS")
      form.append("subjects", JSON.stringify(subjects.map((s) => ({ name: s.name, code: s.code ?? "" }))));
      const { blocks, remaining } = await api("/api/ai/timetable", { method: "POST", form });
      if (blocks.length === 0) {
        setError("The AI couldn't find a timetable in that file. Try a clearer photo, or add things by hand.");
      } else {
        // Meals read from the timetable replace your usual meal of the same name (no double dinner)
        const newMeals = new Set(blocks.filter((b) => b.kind === "meal").map((b) => b.label.toLowerCase()));
        const kept = busy.filter((b) => !(b.kind === "meal" && newMeals.has(b.label.toLowerCase())));
        setBusy([...kept, ...blocks.map((b) => ({ ...b, id: crypto.randomUUID() }))]);
        setNote(
          `The AI added ${blocks.length} block${blocks.length === 1 ? "" : "s"}. Check them against your timetable below, it can misread things. (${remaining} AI requests left today.)`
        );
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setReading(false);
    }
  }

  // Load a week file (e.g. one Claude made from your timetable photos)
  async function onImport(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const result = await readPlanFile(file);
      const blocks = result.kind === "week" ? result.busy : result.data.prefs.busy;
      setBusy([...busy, ...blocks]);
      setNote(`Added ${blocks.length} block${blocks.length === 1 ? "" : "s"} from ${file.name}.`);
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className={`week ${reference ? "with-ref" : ""}`}>
      <div className="week-main">
        {aiOn && (
          <label className="field batch-field">
            <span>Which timetable is yours? (helps when one file has many classes or groups)</span>
            <input
              className="input"
              placeholder="e.g. Year 2 Computer Science, Grade 10 B, Section 3"
              value={batchHint}
              onChange={(e) => setBatchHint(e.target.value)}
            />
          </label>
        )}

        <MealTimes busy={busy} setBusy={setBusy} />

        {/* Drop zone: click or drag a timetable photo onto it */}
        <label
          className={`dropzone ${dragging ? "is-over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            pickFile(e.dataTransfer.files?.[0]);
          }}
        >
          <input type="file" accept="image/*,application/pdf" onChange={onReference} />
          <span className="dropzone-title">
            {reading ? "Reading your timetable…" : "Drop a timetable photo here, or click to choose"}
          </span>
          <span className="dropzone-sub">
            {aiOn
              ? "Class, work or meal timetable, photo or PDF. The AI fills in your week for you."
              : "Class, work or meal timetable, photo or PDF. It shows beside the form so you can copy it."}
          </span>
        </label>
        {info && <p className="info-note">{info}</p>}
        {reading && (
          <p className="info-note">
            The AI is reading your timetable. This takes 10 to 40 seconds (longer if Google is busy, it retries by itself).
          </p>
        )}
        {error && !reading && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {aiOn && reference && !reading && (
          <button className="btn btn-primary read-btn" onClick={() => readWithAI()}>
            {error ? "Try again" : "Read my timetable"}
          </button>
        )}

        <details className="by-hand" open={!aiOn}>
          <summary>{aiOn ? "Or add things by hand" : "Add things by hand"}</summary>
        <div className="form-grid">
          <label className="field span-2">
            <span>What is it?</span>
            <input
              className="input"
              placeholder="e.g. DAA lecture, Lunch, DBMS lab"
              value={draft.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && addBlock()}
            />
          </label>
          <div className="field span-2">
            <span>Type</span>
            <div className="days">
              {Object.entries(KIND_LABEL).map(([k, label]) => (
                <button
                  key={k}
                  aria-pressed={draft.kind === k}
                  className={draft.kind === k ? "on-solid" : ""}
                  onClick={() => setDraft({ ...draft, kind: k })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="field span-2">
            <span>Which days?</span>
            <div className="days">
              {ORDER.map((d) => (
                <button
                  key={d}
                  aria-pressed={draft.days.includes(d)}
                  className={draft.days.includes(d) ? "on-solid" : ""}
                  onClick={() => toggleDay(d)}
                >
                  {WEEKDAYS[d]}
                </button>
              ))}
              <button className="link-btn" onClick={() => setDraft({ ...draft, days: [1, 2, 3, 4, 5] })}>
                Mon to Fri
              </button>
              <button className="link-btn" onClick={() => setDraft({ ...draft, days: [0, 1, 2, 3, 4, 5, 6] })}>
                Every day
              </button>
            </div>
          </div>
          <label className="field">
            <span>From</span>
            <input
              type="time"
              className="input"
              value={draft.start}
              onChange={(e) => setDraft({ ...draft, start: e.target.value })}
            />
          </label>
          <label className="field">
            <span>To</span>
            <input
              type="time"
              className="input"
              value={draft.end}
              onChange={(e) => setDraft({ ...draft, end: e.target.value })}
            />
          </label>
          <button className="btn btn-ghost span-2" onClick={addBlock}>
            Add to my week
          </button>
          {formError && (
            <p className="error span-2" role="alert">
              {formError}
            </p>
          )}
        </div>
        </details>

        {note && !error && <p className="ok-note">{note}</p>}

        <WeekPreview busy={busy} dayStart={dayStart} dayEnd={dayEnd} />

        <p className="small-links">
          <button className="link-btn" onClick={() => importRef.current?.click()}>
            Load a Cramwise backup file (.json)
          </button>
          <input ref={importRef} type="file" accept=".json,application/json" hidden onChange={onImport} />
        </p>

        {busy.length > 0 && (
          <ul className="added">
            {[...busy]
              .sort((a, b) => a.start.localeCompare(b.start))
              .map((b) => (
                <li key={b.id}>
                  <span className={`kind-chip kind-${b.kind}`}>{KIND_LABEL[b.kind]}</span>
                  <b>{b.label}</b>
                  <span className="added-meta">
                    {formatTime(b.start)}–{formatTime(b.end)}, {daysText(b.days)}
                  </span>
                  <button className="link-btn" onClick={() => removeBlock(b.id)}>
                    Remove
                  </button>
                </li>
              ))}
          </ul>
        )}
      </div>

      {reference && (
        <aside className="week-ref">
          <div className="week-ref-head">
            <span>{reference.name}</span>
            <button className="link-btn" onClick={() => setReference(null)}>
              Hide
            </button>
          </div>
          {reference.type === "application/pdf" ? (
            <iframe src={reference.url} title="Your timetable" />
          ) : (
            <img src={reference.url} alt="Your uploaded timetable" />
          )}
        </aside>
      )}
    </div>
  );
}

// A small Mon–Sun picture of your fixed week, so you can spot mistakes
function WeekPreview({ busy, dayStart, dayEnd }) {
  const from = Math.min(timeToMinutes(dayStart), ...busy.map((b) => timeToMinutes(b.start)));
  const to = Math.max(timeToMinutes(dayEnd), ...busy.map((b) => timeToMinutes(b.end)));
  const span = Math.max(60, to - from);

  return (
    <div className="week-preview" aria-label="Preview of your fixed week">
      {ORDER.map((d) => (
        <div key={d} className="wp-day">
          <span className="wp-name">{WEEKDAYS[d]}</span>
          <div className="wp-col">
            {busy
              .filter((b) => b.days.includes(d))
              .map((b) => (
                <span
                  key={b.id}
                  className={`wp-block kind-${b.kind}`}
                  title={`${b.label} ${b.start}–${b.end}`}
                  style={{
                    top: `${((timeToMinutes(b.start) - from) / span) * 100}%`,
                    height: `${((timeToMinutes(b.end) - timeToMinutes(b.start)) / span) * 100}%`,
                  }}
                />
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function daysText(days) {
  const set = [...days].sort();
  if (set.length === 7) return "every day";
  if (set.join() === "1,2,3,4,5") return "Mon to Fri";
  return ORDER.filter((d) => set.includes(d))
    .map((d) => WEEKDAYS[d])
    .join(", ");
}

function addHour(t) {
  const m = Math.min(timeToMinutes(t) + 60, 23 * 60 + 59);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

// Breakfast, lunch and dinner, every day: tick the ones you want blocked out
// and set their times. (Meals that differ by day can be added below as usual.)
const MEALS = [
  { label: "Breakfast", start: "08:00", end: "08:30" },
  { label: "Lunch", start: "13:00", end: "13:45" },
  { label: "Dinner", start: "20:00", end: "20:45" },
];
function MealTimes({ busy, setBusy }) {
  const find = (label) => busy.find((b) => b.kind === "meal" && b.label.toLowerCase() === label.toLowerCase());
  function toggle(m) {
    const b = find(m.label);
    if (b) setBusy(busy.filter((x) => x !== b));
    else setBusy([...busy, { id: crypto.randomUUID(), label: m.label, kind: "meal", days: [0, 1, 2, 3, 4, 5, 6], start: m.start, end: m.end }]);
  }
  function setTime(b, key, value) {
    if (!value) return;
    setBusy(busy.map((x) => (x === b ? { ...x, [key]: value } : x)));
  }
  return (
    <div className="meals">
      <p className="meals-title">Meal times</p>
      <p className="muted meals-sub">Study sessions never land on these.</p>
      <ul>
        {MEALS.map((m) => {
          const b = find(m.label);
          return (
            <li key={m.label} className={b ? "" : "is-off"}>
              <label className="meal-pick">
                <input type="checkbox" checked={Boolean(b)} onChange={() => toggle(m)} />
                <span>{m.label}</span>
              </label>
              {b ? (
                <>
                  <input type="time" className="input qa-time" aria-label={`${m.label} from`} value={b.start} onChange={(e) => setTime(b, "start", e.target.value)} />
                  <span className="muted">to</span>
                  <input type="time" className="input qa-time" aria-label={`${m.label} until`} value={b.end} onChange={(e) => setTime(b, "end", e.target.value)} />
                  {b.days.length < 7 && <span className="muted meal-days">some days only</span>}
                </>
              ) : (
                <span className="muted meal-days">not blocked</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
