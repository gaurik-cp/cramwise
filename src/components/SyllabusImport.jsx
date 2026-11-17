// Optional: import your syllabus. The AI finds each subject and its
// units/topics, you choose what to keep, and they become bosses with
// real chapter names.
//   Step 1: upload a PDF/photo or paste the text (+ optional semester/branch)
//   Step 2: review: pick subjects, units vs topics, exam dates
import { useEffect, useState } from "react";
import { api } from "../utils/api.js";
import { addDays, toISODate } from "../utils/dates.js";
import { inkFor } from "../utils/colors.js";

const AI_OFF = {
  signin: "Reading a syllabus needs the AI, which needs an account. Sign in (Test login works on your laptop) and try again.",
  noserver: "The Cramwise server isn't running, so the AI can't read the syllabus. Start the app with START-CRAMWISE.bat.",
  nokey: "Reading a syllabus needs the AI, and there's no Gemini key in server/.env yet (see SETUP-ONLINE.md).",
};

// Does this syllabus subject match one you already have? (same name, or the
// short name/code appears in the other)
function findMatch(found, existing) {
  const n = found.name.toLowerCase();
  const code = found.code?.toLowerCase().replace(/\s+/g, "");
  const short = abbreviations(found.name);
  return existing.find((s) => {
    const e = s.name.toLowerCase().trim();
    const eNoSpace = e.replace(/\s+/g, "");
    return e === n || (code && (eNoSpace === code || eNoSpace.includes(code))) || short.includes(e) || (e.length >= 6 && n.includes(e));
  });
}

// Short forms students use: "Design and Analysis of Algorithms" -> ["daa", "daaoa"],
// "Theory of Computation" -> ["tc", "toc"], "Database Management Systems" -> ["dms", "dbms"]
const SMALL = new Set(["and", "of", "the", "to", "in", "for", "&", "with"]);
function abbreviations(name) {
  const words = name.toLowerCase().split(/[\s-]+/).filter(Boolean);
  const out = new Set([
    words.filter((w) => !SMALL.has(w)).map((w) => w[0]).join(""),
    words.map((w) => w[0]).join(""),
  ]);
  // "Database" often becomes "DB" (DBMS)
  out.add(words.filter((w) => !SMALL.has(w)).map((w) => (w.startsWith("database") ? "db" : w[0])).join(""));
  return [...out];
}

export default function SyllabusImport({ existing, aiState, onApply, onClose }) {
  const aiOn = aiState === "on";
  const [hint, setHint] = useState("");
  const [file, setFile] = useState(null);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [rows, setRows] = useState(null); // review step

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && !loading && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, loading]);

  async function read() {
    if (!file && !text.trim()) return setError("Upload the syllabus or paste its text first.");
    setLoading(true);
    setError("");
    try {
      const form = new FormData();
      if (file) form.append("file", file);
      else form.append("text", text.trim());
      if (hint.trim()) form.append("hint", hint.trim());
      const { subjects } = await api("/api/ai/syllabus", { method: "POST", form });
      if (subjects.length === 0) {
        setError("The AI couldn't find any subjects. Try a clearer file, or paste the text instead.");
        return;
      }
      setRows(
        subjects.map((s) => {
          const match = findMatch(s, existing);
          const topicCount = s.units.reduce((n, u) => n + u.topics.length, 0);
          return {
            ...s,
            include: true,
            match,
            // Units are usually the right size for "chapters"; fall back to topics if there are very few units
            level: s.units.length >= 3 || topicCount === 0 ? "units" : "topics",
            examDate: match?.examDate ?? toISODate(addDays(new Date(), 21)),
          };
        })
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function chapterNames(r) {
    if (r.level === "units") return r.units.map((u) => u.name);
    return r.units.flatMap((u) => (u.topics.length ? u.topics : [u.name]));
  }

  function update(i, patch) {
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  function apply() {
    let colorIndex = existing.length;
    const result = rows
      .filter((r) => r.include)
      .map((r) => {
        const names = chapterNames(r).filter(Boolean);
        if (r.match) {
          // Keep ticks on chapters with the same name
          const wasDone = new Set((r.match.topics ?? []).filter((t) => t.done).map((t) => t.name.toLowerCase()));
          // No chapter names before, just a count? Then the first N chapters count as done.
          const firstN = r.match.topics?.length ? 0 : r.match.chaptersDone ?? 0;
          return {
            ...r.match,
            examDate: r.examDate,
            topics: names.map((n, k) => ({ name: n, done: wasDone.has(n.toLowerCase()) || k < firstN })),
          };
        }
        return {
          id: crypto.randomUUID(),
          name: (r.code && r.name.length > 24 ? r.code : r.name).slice(0, 40),
          examDate: r.examDate,
          difficulty: 3,
          color: inkFor(colorIndex++),
          topics: names.map((n) => ({ name: n, done: false })),
        };
      });
    onApply(result);
    onClose();
  }

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && !loading && onClose()}>
      <div className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="syl-title">
        <h2 id="syl-title" className="panel-title">
          Import your syllabus
        </h2>

        {!aiOn ? (
          <>
            <p className="info-note">{AI_OFF[aiState]}</p>
            <p className="muted small-gap">
              No AI? You can still add chapter names by hand: on the Bosses tab, press Edit on a subject and paste the
              list of topics, one per line.
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
              Upload your syllabus (PDF or photo) or paste its text. The AI lists each subject with its units and topics,
              then you choose what to add.
            </p>
            <label className="field">
              <span>Your semester / branch (helps when the file covers many)</span>
              <input className="input" value={hint} onChange={(e) => setHint(e.target.value)} placeholder="e.g. Semester 3, CSE with Cyber Security" />
            </label>

            <label className="dropzone syl-drop">
              <input
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setError("");
                }}
              />
              <span className="dropzone-title">{file ? file.name : "Click to choose the syllabus file"}</span>
              <span className="dropzone-sub">{file ? "Click again to pick a different file" : "PDF, PNG or JPG, up to 15 MB"}</span>
            </label>

            {!file && (
              <label className="field">
                <span>Or paste the syllabus text</span>
                <textarea className="input textarea" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="Copy the syllabus from the college website or PDF and paste it here" />
              </label>
            )}

            {error && <p className="error">{error}</p>}
            {loading && <p className="info-note">Reading your syllabus. This can take 20 to 60 seconds for a long PDF.</p>}

            <div className="modal-actions">
              <span className="grow" />
              <button className="btn btn-ghost" onClick={onClose} disabled={loading}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={read} disabled={loading}>
                {loading ? "Reading…" : "Read syllabus"}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="muted small-gap">
              Found {rows.length} subject{rows.length === 1 ? "" : "s"}. Untick the ones you don't want. "Units" = fewer,
              bigger chapters; "Topics" = every topic as its own chapter.
            </p>
            <ul className="syl-list">
              {rows.map((r, i) => {
                const names = chapterNames(r);
                return (
                  <li key={i} className={r.include ? "" : "is-off"}>
                    <label className="syl-pick">
                      <input type="checkbox" checked={r.include} onChange={(e) => update(i, { include: e.target.checked })} />
                      <span className="syl-name">
                        {r.name}
                        {r.code && <small> {r.code}</small>}
                      </span>
                    </label>
                    <span className={`syl-tag ${r.match ? "is-update" : ""}`}>{r.match ? `Updates your ${r.match.name}` : "New boss"}</span>
                    <div className="syl-controls">
                      <div className="seg" role="radiogroup" aria-label="Chapter size">
                        <button role="radio" aria-checked={r.level === "units"} className={r.level === "units" ? "on" : ""} onClick={() => update(i, { level: "units" })}>
                          Units ({r.units.length})
                        </button>
                        <button role="radio" aria-checked={r.level === "topics"} className={r.level === "topics" ? "on" : ""} onClick={() => update(i, { level: "topics" })}>
                          Topics ({r.units.reduce((n, u) => n + (u.topics.length || 1), 0)})
                        </button>
                      </div>
                      <label className="syl-date">
                        <span>Exam</span>
                        <input type="date" className="input" value={r.examDate} onChange={(e) => update(i, { examDate: e.target.value })} />
                      </label>
                    </div>
                    <details className="syl-preview">
                      <summary>See the {names.length} chapters</summary>
                      <ol>
                        {names.map((n, k) => (
                          <li key={k}>{n}</li>
                        ))}
                      </ol>
                    </details>
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
              <button className="btn btn-primary" onClick={apply} disabled={!rows.some((r) => r.include)}>
                Add {rows.filter((r) => r.include).length} subject{rows.filter((r) => r.include).length === 1 ? "" : "s"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
