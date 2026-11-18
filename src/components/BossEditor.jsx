// Pop-up form to add a new boss (exam, or something with no deadline) or edit/delete one,
// right from the Bosses tab, without going back through setup.
import { useEffect, useRef, useState } from "react";
import { addDays, toISODate } from "../utils/dates.js";
import { inkFor } from "../utils/colors.js";
import { parseTopicList, suggestShort } from "../utils/subjects.js";
import DeadlineField from "./DeadlineField.jsx";

export default function BossEditor({ subject, count, existing = [], onSave, onDelete, onClose }) {
  const isNew = !subject;
  const [name, setName] = useState(subject?.name ?? "");
  // "" = no deadline (just learning)
  const [examDate, setExamDate] = useState(subject ? subject.examDate ?? "" : toISODate(addDays(new Date(), 14)));
  const [examTime, setExamTime] = useState(subject?.examTime ?? "");
  // No difficulty is picked for you: only you know how hard a subject is for you
  const [difficulty, setDifficulty] = useState(subject?.difficulty ?? null);
  const [code, setCode] = useState(subject?.code ?? "");
  const [short, setShort] = useState(subject?.short ?? "");
  const [total, setTotal] = useState(subject?.totalChapters ?? 8);
  const [done, setDone] = useState(subject?.chaptersDone ?? 0);
  const [topicText, setTopicText] = useState((subject?.topics ?? []).map((t) => t.name).join("\n"));
  const [error, setError] = useState("");
  const firstRef = useRef(null);

  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const names = parseTopicList(topicText);

  function save() {
    if (!name.trim()) return setError("Give the subject a name.");
    if (!difficulty) return setError("Pick how hard this is for you (1 to 5).");
    if (existing.some((s) => s.id !== subject?.id && s.name.toLowerCase() === name.trim().toLowerCase()))
      return setError(`You already have a boss called ${name.trim()}.`);
    if (names.length === 0 && (!Number.isInteger(Number(total)) || !Number.isInteger(Number(done))))
      return setError("Chapters must be whole numbers (no decimals).");
    // An exam date in the past is only allowed if it was already saved that way
    if (examDate && examDate < toISODate(new Date()) && examDate !== subject?.examDate)
      return setError("That date has already passed. Pick today or a future date (or delete this boss if the exam is over).");
    let next = {
      ...(subject ?? { id: crypto.randomUUID(), color: inkFor(count) }),
      name: name.trim().slice(0, 40),
      examDate,
      examTime: examDate && examTime ? examTime : undefined,
      difficulty,
      code: code.trim() || undefined,
      short: short.trim().toUpperCase() || undefined,
    };
    if (names.length > 0) {
      // Keep the ticks on chapters that were already there (matched by name)
      const wasDone = new Set((subject?.topics ?? []).filter((t) => t.done).map((t) => t.name.toLowerCase()));
      next.topics = names.map((n) => ({ name: n, done: wasDone.has(n.toLowerCase()) }));
    } else {
      const t = Math.max(1, Number(total) || 1);
      const d = Math.min(t, Math.max(0, Number(done) || 0));
      next = { ...next, topics: undefined, totalChapters: t, chaptersDone: d };
    }
    onSave(next);
    onClose();
  }

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="boss-editor-title">
        <h2 id="boss-editor-title" className="panel-title">
          {isNew ? "New boss" : `Edit ${subject.name}`}
        </h2>

        <div className="modal-grid">
          <label className="field">
            <span>Subject</span>
            <input ref={firstRef} className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Calculus, Biology, Learn Spanish" />
          </label>
          <label className="field">
            <span>Course code (optional)</span>
            <input className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. CS 301" maxLength={20} />
          </label>
          <label className="field">
            <span>Short name for the boss board</span>
            <input
              className="input"
              value={short}
              onChange={(e) => setShort(e.target.value)}
              placeholder={suggestShort(name || "Subject", code)}
              maxLength={10}
            />
          </label>
          <DeadlineField
            examDate={examDate}
            examTime={examTime}
            onChange={(v) => {
              setExamDate(v.examDate);
              setExamTime(v.examTime);
            }}
          />
          <div className="field span-all">
            <span>How hard is this for you? (1 easy, 5 brutal)</span>
            <div className="scale" role="radiogroup" aria-label="Difficulty">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} role="radio" aria-checked={difficulty === n} className={difficulty === n ? "on" : ""} onClick={() => setDifficulty(n)}>
                  {n}
                </button>
              ))}
            </div>
          </div>

          <label className="field span-all">
            <span>Chapter names (optional, one per line). Then each quest tells you what to study.</span>
            <textarea
              className="input textarea"
              rows={5}
              value={topicText}
              onChange={(e) => setTopicText(e.target.value)}
              placeholder={"Rod cutting\nMatrix chain multiplication\nLCS\nFloyd-Warshall"}
            />
            {names.length > 0 && <small className="field-hint">{names.length} chapters</small>}
          </label>

          {names.length === 0 && (
            <>
              <label className="field">
                <span>Total chapters</span>
                <input type="number" min="1" className="input" value={total} onChange={(e) => setTotal(e.target.value)} />
              </label>
              <label className="field">
                <span>Already done</span>
                <input type="number" min="0" className="input" value={done} onChange={(e) => setDone(e.target.value)} />
              </label>
            </>
          )}
        </div>

        {error && <p className="error">{error}</p>}

        <div className="modal-actions">
          {!isNew && (
            <button
              className="link-btn danger-link"
              onClick={() => {
                if (window.confirm(`Delete ${subject.name}? Your XP stays.`)) {
                  onDelete(subject.id);
                  onClose();
                }
              }}
            >
              Delete this boss
            </button>
          )}
          <span className="grow" />
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save}>
            {isNew ? "Add boss" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
