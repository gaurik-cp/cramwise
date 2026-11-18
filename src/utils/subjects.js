// Helpers for subjects ("bosses") and their chapters.
//
// A subject can just have numbers (totalChapters, chaptersDone), OR a list
// of real chapter names:  topics: [{ name: "Rod cutting", done: true }, ...]
// When it has topics, the numbers are always worked out FROM the topics,
// so the two never disagree.

// Keep totalChapters/chaptersDone in step with the topic list
export function syncCounts(subject) {
  if (!Array.isArray(subject.topics) || subject.topics.length === 0) {
    const { topics, ...rest } = subject;
    return rest;
  }
  return {
    ...subject,
    totalChapters: subject.topics.length,
    chaptersDone: subject.topics.filter((t) => t.done).length,
  };
}

// The first chapter you haven't finished yet (or null)
export function nextTopic(subject) {
  return subject.topics?.find((t) => !t.done)?.name ?? null;
}

// +1 / -1 chapter. With topics: tick the next unfinished one, or untick the
// last finished one. Returns [newSubject, howManyActuallyChanged].
export function bumpChapters(subject, delta) {
  if (subject.topics?.length) {
    const topics = subject.topics.map((t) => ({ ...t }));
    if (delta > 0) {
      const i = topics.findIndex((t) => !t.done);
      if (i === -1) return [subject, 0];
      topics[i].done = true;
    } else {
      const i = topics.map((t) => t.done).lastIndexOf(true);
      if (i === -1) return [subject, 0];
      topics[i].done = false;
    }
    return [syncCounts({ ...subject, topics }), delta > 0 ? 1 : -1];
  }
  const next = Math.min(subject.totalChapters, Math.max(0, subject.chaptersDone + delta));
  return [{ ...subject, chaptersDone: next }, next - subject.chaptersDone];
}

// Tick/untick one specific chapter. Returns [newSubject, +1 or -1].
export function toggleTopic(subject, index) {
  const topics = subject.topics.map((t, i) => (i === index ? { ...t, done: !t.done } : t));
  return [syncCounts({ ...subject, topics }), topics[index].done ? 1 : -1];
}

// "Rod cutting\nLCS, Floyd-Warshall" -> ["Rod cutting", "LCS", "Floyd-Warshall"]
// (one per line; commas also split when everything is on one line)
export function parseTopicList(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const parts = lines.length === 1 ? lines[0].split(/[,;]/) : lines;
  // Strip list markers like "- ", "* ", "1. ", "2) " but keep real numbers ("3D graphics", "8086")
  return parts.map((p) => p.trim().replace(/^([-*•]|\d+[.)])\s+/, "").trim()).filter(Boolean).slice(0, 80);
}

// Makes sure every subject is usable, fixing what it can and dropping what
// it can't. Protects against broken backup files or old saved data
// (a broken exam date would otherwise crash the timetable).
export function cleanSubjects(list) {
  if (!Array.isArray(list)) return [];
  const isDate = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
  const int = (v, fallback, min, max) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  return list
    // examDate "" (or missing) = no exam or deadline, just learning
    .filter((s) => s && typeof s === "object" && typeof s.name === "string" && s.name.trim() && (isDate(s.examDate) || !s.examDate))
    .slice(0, 50)
    .map((s, i) => {
      const topics = Array.isArray(s.topics)
        ? s.topics
            .filter((t) => t && typeof t.name === "string" && t.name.trim())
            .map((t) => ({ name: t.name.trim().slice(0, 80), done: Boolean(t.done) }))
            .slice(0, 80)
        : undefined;
      const total = int(s.totalChapters, 1, 1, 500);
      return syncCounts({
        ...s,
        id: typeof s.id === "string" && s.id ? s.id : `s-${i}-${s.name}`,
        name: s.name.trim().slice(0, 40),
        examDate: isDate(s.examDate) ? s.examDate : "",
        examTime: /^\d{2}:\d{2}$/.test(s.examTime ?? "") ? s.examTime : undefined,
        code: typeof s.code === "string" && s.code.trim() ? s.code.trim().slice(0, 20) : undefined,
        short: typeof s.short === "string" && s.short.trim() ? s.short.trim().slice(0, 10) : undefined,
        difficulty: int(s.difficulty, 3, 1, 5),
        totalChapters: total,
        chaptersDone: int(s.chaptersDone, 0, 0, total),
        topics: topics?.length ? topics : undefined,
      });
    });
}

// ─── Short names for the boss board (it only fits 10 letters) ───
// "Database Management Systems" -> "DBMS", "Calculus II" -> "CALC II",
// "English Literature" -> "ENG LIT", "Physics" -> "PHYSICS".
// The person can always type their own short name in the boss editor.
const STOP = new Set(["and", "of", "the", "to", "in", "for", "&", "with", "a", "an", "on", "introduction", "intro", "learn", "learning", "basics", "fundamentals", "principles"]);
const ROMAN = /^(i{1,3}|iv|v|vi{0,3}|ix|x|\d+)$/i;
export function suggestShort(name, code) {
  const clean = (name ?? "").trim();
  if (clean.length <= 10) return clean.toUpperCase();
  const words = clean.split(/[\s\-:,/]+/).filter(Boolean);
  const tail = words.length > 1 && ROMAN.test(words[words.length - 1]) ? words.pop().toUpperCase() : "";
  const main = words.filter((w) => !STOP.has(w.toLowerCase()));
  let short;
  if (main.length >= 3) {
    short = main.map((w) => (/^database/i.test(w) ? "DB" : w[0])).join("").toUpperCase();
  } else if (main.length === 2) {
    // "Theory of Computation" -> "TOC" (with the small words), else "Linear Algebra" -> "LIN ALG"
    const withSmall = words.map((w) => w[0]).join("");
    short = (withSmall.length >= 3 ? withSmall : main.map((w) => w.slice(0, 3)).join(" ")).toUpperCase();
  } else {
    const w = main[0] ?? clean;
    short = (tail || w.length > 10 ? w.slice(0, 4) : w).toUpperCase();
  }
  let out = tail ? `${short} ${tail}` : short;
  if (out.length > 10 && tail) out = `${main.map((w) => w[0]).join("").toUpperCase()} ${tail}`; // "EM III"
  if (out.length <= 10) return out;
  const c = (code ?? "").trim();
  return c && c.length <= 10 ? c.toUpperCase() : out.slice(0, 10);
}
export const boardName = (s) => s.short || suggestShort(s.name, s.code);
