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
        difficulty: int(s.difficulty, 3, 1, 5),
        totalChapters: total,
        chaptersDone: int(s.chaptersDone, 0, 0, total),
        topics: topics?.length ? topics : undefined,
      });
    });
}
