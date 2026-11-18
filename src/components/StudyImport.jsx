// Import your EXAM TIMETABLE and/or SYLLABUS. The AI reads them, then you
// check everything in one table before it's added.
//
//   Step 1: upload one or both (PDF/photo, or paste the text), plus an optional
//           "which ones are yours?" note for files that cover many classes
//   Step 2: one row per subject: exam date + time (from the timetable),
//           chapters (from the syllabus), and whether it's new or updates a
//           subject you already have. Fix anything, untick what you don't want.
//
// Works anywhere: the browser's region tells the AI how to read dates like
// 05/12 (5 Dec in most countries, May 12 in the US).
import { useEffect, useState } from "react";
import { api } from "../utils/api.js";
import { formatDay, formatTime, parseISODate, toISODate } from "../utils/dates.js";
import { inkFor } from "../utils/colors.js";

const AI_OFF = {
  signin: "Reading files needs the AI, which needs an account. Sign in and try again.",
  noserver: "The Cramwise server isn't running, so the AI can't read files right now.",
  nokey: "Reading files needs the AI, and it isn't set up on this server yet.",
};

// ─── Matching names: "DBMS" = "Database Management Systems", "CS 301" = "CS301" ───
const SMALL = new Set(["and", "of", "the", "to", "in", "for", "&", "with", "a", "an", "i", "ii", "iii"]);
function abbreviations(name) {
  const words = name.toLowerCase().split(/[\s\-:,/]+/).filter(Boolean);
  const out = new Set([words.filter((w) => !SMALL.has(w)).map((w) => w[0]).join(""), words.map((w) => w[0]).join("")]);
  out.add(words.filter((w) => !SMALL.has(w)).map((w) => (w.startsWith("database") ? "db" : w[0])).join(""));
  return [...out].filter((a) => a.length >= 2);
}
const squash = (x) => (x ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
export function sameSubject(a, b) {
  const an = (a.name ?? "").toLowerCase().trim();
  const bn = (b.name ?? "").toLowerCase().trim();
  if (!an || !bn) return false;
  if (an === bn) return true;
  const ac = squash(a.code);
  const bc = squash(b.code);
  if (ac && bc && ac === bc) return true;
  if (ac && squash(bn).includes(ac)) return true;
  if (bc && squash(an).includes(bc)) return true;
  if (abbreviations(a.name).includes(squash(bn)) || abbreviations(b.name).includes(squash(an))) return true;
  // One name contains the other ("Physics" vs "Physics I"), only for real words
  return (an.length >= 5 && bn.includes(an)) || (bn.length >= 5 && an.includes(bn));
}

// "en-US" -> "US", for reading ambiguous dates the local way
function region() {
  const lang = navigator.languages?.[0] || navigator.language || "";
  return lang.split("-")[1]?.toUpperCase() || lang || "unknown";
}

// "CS301", "MA 102", "ICS-211A" look like course codes; "Calculus II" doesn't
export const looksLikeCode = (x) => /^[A-Za-z]{2,5}\s?-?\d{2,4}[A-Za-z]?$/.test((x ?? "").trim());

// Builds the review rows from what the AI found
export function buildRows(syllabus, exams, existing, today = toISODate(new Date())) {
  // "CS301" with no separate code: the subject IS the code
  exams = exams.map((e) => (!e.code && looksLikeCode(e.subject) ? { ...e, code: e.subject } : e));
  // For each subject keep only its NEXT exam (a timetable can list midterms and finals)
  const upcoming = exams.filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const nextExams = [];
  for (const e of upcoming) if (!nextExams.some((x) => sameSubject(x, { name: e.subject, code: e.code }) || x.name === e.subject)) nextExams.push({ ...e, name: e.subject });

  const rows = syllabus.map((s) => ({ name: s.name, code: s.code, units: s.units, exam: null }));
  for (const e of nextExams) {
    const row = rows.find((r) => !r.exam && sameSubject(r, e));
    if (row) {
      row.exam = e;
      row.code = row.code || e.code; // the timetable may know the code when the syllabus doesn't
    } else rows.push({ name: e.name, code: e.code, units: [], exam: e });
  }
  // Same subject written two ways? Use the way the uploaded timetable mostly writes them
  const codeLike = exams.filter((e) => looksLikeCode(e.subject)).length;
  const naming = exams.length && codeLike > exams.length / 2 ? "code" : "name";
  const pastOnly = exams.length > 0 && upcoming.length === 0;

  return {
    pastOnly,
    naming,
    rows: rows.map((r) => {
      const match = existing.find((x) => sameSubject(x, r));
      const topicCount = r.units.reduce((n, u) => n + u.topics.length, 0);
      return {
        ...r,
        include: true,
        match,
        level: r.units.length >= 3 || topicCount === 0 ? "units" : "topics",
        // From the timetable; otherwise keep the date you already had; otherwise no date yet
        examDate: r.exam?.date ?? match?.examDate ?? "",
        examTime: r.exam?.time ?? (r.exam ? "" : match?.examTime ?? ""),
        chapters: match?.totalChapters ?? 8,
        code: r.code || match?.code || "",
        // Only you know how hard a subject is for you, so new ones start unpicked
        difficulty: match?.difficulty ?? null,
      };
    }),
  };
}

function chapterNames(r) {
  if (!r.units.length) return [];
  if (r.level === "units") return r.units.map((u) => u.name);
  return r.units.flatMap((u) => (u.topics.length ? u.topics : [u.name]));
}

export default function StudyImport({ existing, aiState, onApply, onClose }) {
  const aiOn = aiState === "on";
  const [hint, setHint] = useState("");
  const [examFile, setExamFile] = useState(null);
  const [examText, setExamText] = useState("");
  const [sylFile, setSylFile] = useState(null);
  const [sylText, setSylText] = useState("");
  const [paste, setPaste] = useState({ exam: false, syl: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState([]);
  const [rows, setRows] = useState(null); // review step
  const [naming, setNaming] = useState("name"); // write subjects as their "name" or course "code"

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && !loading && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, loading]);

  const hasExam = Boolean(examFile || examText.trim());
  const hasSyl = Boolean(sylFile || sylText.trim());

  async function read() {
    if (!hasExam && !hasSyl) return setError("Add your exam timetable, your syllabus, or both.");
    setLoading(true);
    setError("");
    setNotes([]);
    const form = (file, text, extra = {}) => {
      const f = new FormData();
      if (file) f.append("file", file);
      else f.append("text", text.trim());
      if (hint.trim()) f.append("hint", hint.trim());
      Object.entries(extra).forEach(([k, v]) => f.append(k, v));
      return f;
    };
    const [ex, sy] = await Promise.allSettled([
      hasExam ? api("/api/ai/exams", { method: "POST", form: form(examFile, examText, { region: region(), today: toISODate(new Date()) }) }) : null,
      hasSyl ? api("/api/ai/syllabus", { method: "POST", form: form(sylFile, sylText) }) : null,
    ]);
    setLoading(false);

    const problems = [];
    if (ex.status === "rejected") problems.push(`Exam timetable: ${ex.reason.message}`);
    if (sy.status === "rejected") problems.push(`Syllabus: ${sy.reason.message}`);
    const exams = ex.value?.exams ?? [];
    const syllabus = sy.value?.subjects ?? [];
    if (hasExam && ex.status === "fulfilled" && exams.length === 0) problems.push("No exams were found in the timetable. Try a clearer file, or paste the text.");
    if (hasSyl && sy.status === "fulfilled" && syllabus.length === 0) problems.push("No subjects were found in the syllabus. Try a clearer file, or paste the text.");

    const built = buildRows(syllabus, exams, existing);
    if (built.pastOnly) problems.push("Every exam in that timetable has already happened, so no dates were added.");
    if (built.rows.length === 0) {
      setError(problems.join(" ") || "Nothing could be read from those files.");
      return;
    }
    setNotes(problems);
    setNaming(built.naming);
    setRows(built.rows);
  }

  function update(i, patch) {
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  // One style for every subject: all names, or all course codes (when known)
  const shown = (r) => (naming === "code" && r.code ? r.code : r.name).slice(0, 40);

  function apply() {
    let colorIndex = existing.length;
    const picked = rows.filter((r) => r.include);
    const result = picked.map((r) => {
      const names = chapterNames(r).filter(Boolean);
      const when = { examDate: r.examDate || "", examTime: r.examDate && r.examTime ? r.examTime : undefined };
      if (r.match) {
        const same = { name: shown(r), code: r.code || r.match.code, difficulty: r.difficulty };
        if (!names.length) return { ...r.match, ...when, ...same }; // only the date changed
        // Keep ticks on chapters with the same name
        const wasDone = new Set((r.match.topics ?? []).filter((t) => t.done).map((t) => t.name.toLowerCase()));
        // No chapter names before, just a count? Then the first N chapters count as done.
        const firstN = r.match.topics?.length ? 0 : r.match.chaptersDone ?? 0;
        return { ...r.match, ...when, ...same, topics: names.map((n, k) => ({ name: n, done: wasDone.has(n.toLowerCase()) || k < firstN })) };
      }
      const base = {
        id: crypto.randomUUID(),
        name: shown(r),
        code: r.code || undefined,
        ...when,
        difficulty: r.difficulty,
        color: inkFor(colorIndex++),
      };
      return names.length
        ? { ...base, topics: names.map((n) => ({ name: n, done: false })) }
        : { ...base, totalChapters: Math.max(1, Math.round(Number(r.chapters)) || 1), chaptersDone: 0 };
    });
    onApply(result);
    onClose();
  }

  const count = rows?.filter((r) => r.include).length ?? 0;
  const needDifficulty = rows?.filter((r) => r.include && !r.difficulty).length ?? 0;
  const anyCodes = rows?.some((r) => r.code) ?? false;

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && !loading && onClose()}>
      <div className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="imp-title">
        <h2 id="imp-title" className="panel-title">
          Import exams and syllabus
        </h2>

        {!aiOn ? (
          <>
            <p className="info-note">{AI_OFF[aiState]}</p>
            <p className="muted small-gap">
              No AI? You can still add everything by hand: press Edit on a boss to set its exam date and paste its chapter
              names, one per line.
            </p>
            <div className="modal-actions">
              <span className="grow" />
              <button className="btn btn-ghost" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        ) : !rows ? (
          <>
            <p className="muted small-gap">
              Add one or both. The exam timetable gives each subject its exam date and time; the syllabus gives its chapters.
              You'll check everything before it's added.
            </p>

            <label className="field">
              <span>Which ones are yours? (optional, helps when a file covers many classes)</span>
              <input className="input" value={hint} onChange={(e) => setHint(e.target.value)} placeholder="e.g. Year 2 Computer Science, CS101 and CS102, Grade 10 B" />
            </label>

            <div className="imp-pair">
              <ImportBox
                title="Exam timetable"
                sub="The list of exam dates (a date sheet or exam schedule)"
                file={examFile}
                setFile={setExamFile}
                text={examText}
                setText={setExamText}
                pasting={paste.exam}
                setPasting={(v) => setPaste({ ...paste, exam: v })}
                placeholder={"Paste the exam timetable, e.g.\nMon 21 Dec, 9:30  CS301 Databases\nWed 23 Dec, 14:00  Algorithms"}
              />
              <ImportBox
                title="Syllabus"
                sub="Your subjects with their units or topics"
                file={sylFile}
                setFile={setSylFile}
                text={sylText}
                setText={setSylText}
                pasting={paste.syl}
                setPasting={(v) => setPaste({ ...paste, syl: v })}
                placeholder="Copy the syllabus from your school's website or PDF and paste it here"
              />
            </div>

            {error && <p className="error">{error}</p>}
            {loading && <p className="info-note">Reading your files. This can take 20 to 60 seconds for a long PDF.</p>}

            <div className="modal-actions">
              <span className="grow" />
              <button className="btn btn-ghost" onClick={onClose} disabled={loading}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={read} disabled={loading || (!hasExam && !hasSyl)}>
                {loading ? "Reading…" : hasExam && hasSyl ? "Read both" : "Read it"}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="muted small-gap">
              Found {rows.length} subject{rows.length === 1 ? "" : "s"}. Untick what you don't want and fix any date that looks
              wrong. Leave the date empty for something with no exam. Pick how hard each one is <b>for you</b>.
            </p>
            {anyCodes && (
              <div className="imp-naming">
                <span>Write subjects as</span>
                <div className="seg" role="radiogroup" aria-label="Write subjects as">
                  <button role="radio" aria-checked={naming === "name"} className={naming === "name" ? "on" : ""} onClick={() => setNaming("name")}>
                    Names
                  </button>
                  <button role="radio" aria-checked={naming === "code"} className={naming === "code" ? "on" : ""} onClick={() => setNaming("code")}>
                    Course codes
                  </button>
                </div>
                <small className="muted">Everything (bosses, quests, timetable) uses the same style.</small>
              </div>
            )}
            {notes.map((n) => (
              <p key={n} className="info-note">
                {n}
              </p>
            ))}
            <ul className="syl-list">
              {rows.map((r, i) => {
                const names = chapterNames(r);
                return (
                  <li key={i} className={r.include ? "" : "is-off"}>
                    <label className="syl-pick">
                      <input type="checkbox" checked={r.include} onChange={(e) => update(i, { include: e.target.checked })} />
                      <span className="syl-name">
                        {shown(r)}
                        {r.code && r.code !== shown(r) && <small> {r.code}</small>}
                        {r.code && r.code === shown(r) && r.name !== r.code && <small> {r.name}</small>}
                        {r.exam?.kind && <small> {r.exam.kind}</small>}
                      </span>
                    </label>
                    <span className={`syl-tag ${r.match ? "is-update" : ""}`}>{r.match ? `Updates your ${r.match.name}` : "New boss"}</span>
                    <div className="syl-controls imp-diff">
                      <span className="muted">How hard for you?</span>
                      <div className="scale small-scale" role="radiogroup" aria-label={`How hard is ${shown(r)} for you`}>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button key={n} role="radio" aria-checked={r.difficulty === n} className={r.difficulty === n ? "on" : ""} onClick={() => update(i, { difficulty: n })}>
                            {n}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="syl-controls">
                      <label className="syl-date">
                        <span>Exam</span>
                        <input type="date" className="input" value={r.examDate} onChange={(e) => update(i, { examDate: e.target.value })} />
                      </label>
                      {r.examDate ? (
                        <>
                          <label className="syl-date">
                            <span>at</span>
                            <input type="time" className="input" value={r.examTime} onChange={(e) => update(i, { examTime: e.target.value })} aria-label="Exam time (optional)" />
                          </label>
                          <button className="link-btn" onClick={() => update(i, { examDate: "", examTime: "" })}>
                            No deadline
                          </button>
                        </>
                      ) : (
                        <span className="muted imp-nodate">No date: studied at a steady pace</span>
                      )}
                      {r.units.length > 0 ? (
                        <div className="seg" role="radiogroup" aria-label="Chapter size">
                          <button role="radio" aria-checked={r.level === "units"} className={r.level === "units" ? "on" : ""} onClick={() => update(i, { level: "units" })}>
                            Units ({r.units.length})
                          </button>
                          <button role="radio" aria-checked={r.level === "topics"} className={r.level === "topics" ? "on" : ""} onClick={() => update(i, { level: "topics" })}>
                            Topics ({r.units.reduce((n, u) => n + (u.topics.length || 1), 0)})
                          </button>
                        </div>
                      ) : r.match ? (
                        <span className="muted imp-nodate">Keeps your {r.match.totalChapters} chapters</span>
                      ) : (
                        <label className="syl-date">
                          <span>Chapters</span>
                          <input type="number" min="1" className="input imp-num" value={r.chapters} onChange={(e) => update(i, { chapters: e.target.value })} />
                        </label>
                      )}
                    </div>
                    {r.exam && (
                      <p className="imp-from">
                        Exam timetable: {formatDay(parseISODate(r.exam.date))}
                        {r.exam.time ? `, ${formatTime(r.exam.time)}` : ""}
                      </p>
                    )}
                    {names.length > 0 && (
                      <details className="syl-preview">
                        <summary>See the {names.length} chapters</summary>
                        <ol>
                          {names.map((n, k) => (
                            <li key={k}>{n}</li>
                          ))}
                        </ol>
                      </details>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="modal-actions">
              <button className="link-btn" onClick={() => setRows(null)}>
                Back
              </button>
              <span className="grow" />
              <button className="btn btn-ghost" onClick={onClose}>
                Cancel
              </button>
              {needDifficulty > 0 && <span className="muted imp-need">Pick how hard {needDifficulty === 1 ? "1 more subject is" : `${needDifficulty} more subjects are`}</span>}
              <button className="btn btn-primary" onClick={apply} disabled={count === 0 || needDifficulty > 0}>
                Add {count} subject{count === 1 ? "" : "s"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// One upload box: choose a file, or switch to pasting the text
function ImportBox({ title, sub, file, setFile, text, setText, pasting, setPasting, placeholder }) {
  return (
    <div className={`imp-box ${file || text.trim() ? "is-set" : ""}`}>
      <p className="imp-title">{title}</p>
      <p className="imp-sub">{sub}</p>
      {pasting ? (
        <textarea className="input textarea" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label={`${title} text`} />
      ) : (
        <label className="dropzone imp-drop">
          <input
            type="file"
            accept="image/*,application/pdf"
            aria-label={`${title} file`}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <span className="dropzone-title">{file ? file.name : "Choose a PDF or photo"}</span>
          <span className="dropzone-sub">{file ? "Click to pick a different file" : "Up to 15 MB"}</span>
        </label>
      )}
      <div className="imp-links">
        <button
          className="link-btn"
          onClick={() => {
            setPasting(!pasting);
            if (!pasting) setFile(null);
            else setText("");
          }}
        >
          {pasting ? "Upload a file instead" : "Paste the text instead"}
        </button>
        {(file || text.trim()) && (
          <button
            className="link-btn"
            onClick={() => {
              setFile(null);
              setText("");
            }}
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}
