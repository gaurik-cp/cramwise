// ─────────────────────────────────────────────────────────────
// TIMETABLE GENERATOR (the "smart scheduling" logic)
//
// For each day we:
//   1. Find your FREE time: your study window (e.g. 07:00 to 22:30)
//      minus your fixed blocks (classes, labs, work, meals...).
//   2. Cut that free time into study slots (session + break),
//      up to your daily study hours.
//   3. Drop subjects whose exam is already over (or is today).
//   4. Re-calculate each subject's urgency FOR THAT DAY
//      (a subject gets more urgent as its exam gets closer).
//   5. Share the slots out in proportion to urgency, with rules:
//        • The day before an exam, that subject gets at least
//          half of the day's sessions (revision day).
//        • Every remaining subject gets at least 1 session every
//          2 days, so nothing is forgotten.
//   6. Order the sessions so the same subject isn't back-to-back,
//      and harder subjects come earlier (when your brain is fresh).
// ─────────────────────────────────────────────────────────────

import { urgencyScore } from "./urgency.js";
import {
  addDays,
  daysBetween,
  daysToDeadline,
  hasDeadline,
  parseISODate,
  toISODate,
  minutesToTime,
  timeToMinutes,
} from "./dates.js";

// Older saved plans had only `startTime`. This fills in the new settings
// (study window + fixed blocks) so old plans keep working.
export function normalizePrefs(prefs = {}) {
  const time = (t, fallback) => (/^\d{2}:\d{2}$/.test(t ?? "") ? t : fallback);
  const num = (v, fallback, min, max) => {
    if (v === "" || v === null || v === undefined) return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
  };
  // Every number is forced into a sensible range, so a typo can never
  // break the timetable (e.g. a negative break would loop forever).
  return {
    ...prefs,
    dayStart: time(prefs.dayStart ?? prefs.startTime, "08:00"),
    dayEnd: time(prefs.dayEnd, "22:30"),
    hoursPerDay: num(prefs.hoursPerDay, 4, 1, 14),
    sessionLength: num(prefs.sessionLength, 50, 15, 240),
    breakLength: num(prefs.breakLength, 10, 0, 120),
    planDays: num(prefs.planDays, 14, 1, 60),
    restDays: Array.isArray(prefs.restDays) ? prefs.restDays.filter((d) => d >= 0 && d <= 6).slice(0, 6) : [0],
    busy: withMeals(prefs),
    mealsSet: true,
    dayWindows: cleanWindows(prefs.dayWindows),
    changes: cleanChanges(prefs.changes),
  };
}

// ─── Meals ───
// Everyone eats, so breakfast, lunch and dinner are blocked out by default
// (you can change the times or remove them in "Classes, work & meals").
// Only added once: if you delete them, they stay deleted.
export const DEFAULT_MEALS = [
  { id: "meal-breakfast", label: "Breakfast", start: "08:00", end: "08:30" },
  { id: "meal-lunch", label: "Lunch", start: "13:00", end: "13:45" },
  { id: "meal-dinner", label: "Dinner", start: "20:00", end: "20:45" },
];
function withMeals(prefs) {
  const busy = Array.isArray(prefs.busy) ? prefs.busy : [];
  if (prefs.mealsSet || busy.some((b) => b.kind === "meal")) return busy;
  return [...busy, ...DEFAULT_MEALS.map((m) => ({ ...m, kind: "meal", days: [0, 1, 2, 3, 4, 5, 6] }))];
}

// ─── Different study hours on some days ───
// e.g. { "3": { start: "13:30", end: "23:00" } } = on Wednesdays study from 1:30 PM
function cleanWindows(w) {
  if (!w || typeof w !== "object" || Array.isArray(w)) return {};
  const ok = (t) => /^\d{2}:\d{2}$/.test(t ?? "");
  const out = {};
  for (const [d, v] of Object.entries(w)) {
    if (/^[0-6]$/.test(d) && v && ok(v.start) && ok(v.end)) out[d] = { start: v.start, end: v.end };
  }
  return out;
}
// The study window for one weekday (its own times, or the usual ones)
export function windowFor(prefs, weekday) {
  return prefs.dayWindows?.[weekday] ?? { start: prefs.dayStart, end: prefs.dayEnd };
}

// "Start right after my last class": for each weekday with classes or labs,
// begin studying 15 minutes after the last one ends (if that's later than usual)
export function windowsAfterClasses(prefs) {
  const out = {};
  for (let d = 0; d < 7; d++) {
    const classes = prefs.busy.filter((b) => (b.kind === "class" || b.kind === "lab") && b.days.includes(d));
    if (!classes.length) continue;
    const lastEnd = Math.max(...classes.map((b) => timeToMinutes(b.end)));
    const start = lastEnd + 15;
    if (start >= 24 * 60) continue;
    out[d] = { start: minutesToTime(start), end: prefs.dayEnd };
  }
  return out;
}

// One-off changes for a single date ("just this once"), e.g.
//   { "2026-10-14": { off: true }, "2026-10-15": { hours: 2, busy: [{ label: "Fest", start: "16:00", end: "20:00" }] } }
// Days that are already over are dropped, so the list never grows forever.
function cleanChanges(changes) {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) return {};
  const today = toISODate(new Date());
  const out = {};
  Object.entries(changes).forEach(([date, c]) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today || !c || typeof c !== "object") return;
    const clean = {};
    if (c.off === true) clean.off = true;
    const hours = Number(c.hours);
    if (Number.isFinite(hours) && hours >= 1 && hours <= 14) clean.hours = Math.round(hours);
    const busy = (Array.isArray(c.busy) ? c.busy : []).filter(
      (b) => b && /^\d{2}:\d{2}$/.test(b.start ?? "") && /^\d{2}:\d{2}$/.test(b.end ?? "") && b.start < b.end
    );
    if (busy.length) clean.busy = busy.map((b) => ({ id: b.id, label: String(b.label || "Busy").slice(0, 40), kind: "other", start: b.start, end: b.end }));
    if (Object.keys(clean).length) out[date] = clean;
  });
  return out;
}

// Fixed blocks for one day, sorted by start time: your usual week for that
// weekday, plus anything you added just for that date
export function busyFor(prefs, weekday, isoDate) {
  const once = (isoDate && prefs.changes?.[isoDate]?.busy) || [];
  return [...prefs.busy.filter((b) => b.days.includes(weekday)), ...once].sort(
    (a, b) => timeToMinutes(a.start) - timeToMinutes(b.start)
  );
}

// Step 1 + 2: find study slots in the gaps between fixed blocks.
// Example: window 07:00-22:00, class 09:00-17:00, 50-min sessions, 10-min breaks
//   -> slots 07:00, 08:00 (morning gap), then 17:10, 18:10 ... (evening gap)
// We keep a small gap (the break length) after each fixed block too,
// so you have time to walk back from class or a meal.
export function findSlots(prefs, weekday, maxSlots, isoDate) {
  const len = Math.max(15, Number(prefs.sessionLength) || 50);
  const brk = Math.max(0, Number(prefs.breakLength) || 0);
  const win = windowFor(prefs, weekday); // some days can have their own study hours
  const dayStart = timeToMinutes(win.start);
  // A finish time EARLIER than the start means "after midnight", e.g. 17:05 -> 00:30.
  // So we add 24 hours (1440 minutes) to it: 00:30 becomes 24:30.
  let dayEnd = timeToMinutes(win.end);
  if (dayEnd <= dayStart) dayEnd += 24 * 60;

  // Turn fixed blocks into "no-go" ranges (with a gap before and after)
  // (each block is also copied 24h later, in case your window runs past midnight)
  const blocked = busyFor(prefs, weekday, isoDate).flatMap((b) => {
    const range = [timeToMinutes(b.start) - brk, timeToMinutes(b.end) + brk];
    return [range, [range[0] + 1440, range[1] + 1440]];
  });

  const slots = [];
  let cursor = dayStart;
  while (cursor + len <= dayEnd && slots.length < maxSlots) {
    // Does a session starting at `cursor` overlap any no-go range?
    const clash = blocked.find(([bs, be]) => cursor < be && cursor + len > bs);
    if (clash) {
      cursor = Math.max(cursor, clash[1]); // jump past the block
      continue;
    }
    slots.push(cursor);
    cursor += len + brk;
  }
  return slots;
}

export function generateTimetable(subjects, rawPrefs, startDate = new Date()) {
  const prefs = normalizePrefs(rawPrefs);
  const days = [];
  const sessionLen = Number(prefs.sessionLength);
  const breakLen = Number(prefs.breakLength);
  const minutesPerDay = Number(prefs.hoursPerDay) * 60;

  // The most sessions you want in a day (the last one needs no break after it)
  const sessionsPerDay = Math.max(1, Math.floor((minutesPerDay + breakLen) / (sessionLen + breakLen)));

  // Remember the last day each subject was studied (for the "don't forget" rule).
  const lastStudied = {};

  for (let i = 0; i < Number(prefs.planDays); i++) {
    const date = addDays(startDate, i);
    const weekday = date.getDay(); // 0 = Sunday
    const iso = toISODate(date);
    const change = prefs.changes[iso] ?? {};
    const busy = busyFor(prefs, weekday, iso);
    const base = { date: iso, busy, sessions: [], changed: Object.keys(change).length > 0 };

    // "Day off just this once" always wins: you said you can't study that day
    if (change.off) {
      days.push({ ...base, rest: true, offOnce: true });
      continue;
    }

    // Step 3: only subjects whose exam is still ahead, plus ones with no
    // deadline that still have chapters left (or no chapter list at all)
    const active = subjects.filter((s) =>
      hasDeadline(s) ? daysToDeadline(s, date) > 0 : (s.totalChapters ?? 1) - (s.chaptersDone ?? 0) > 0
    );

    // Day off chosen by the user, BUT never the day before an exam,
    // because that's the most important revision day.
    const examTomorrow = active.some((s) => daysToDeadline(s, date) === 1);
    const skippedRest = prefs.restDays.includes(weekday) && examTomorrow;
    if (prefs.restDays.includes(weekday) && !examTomorrow) {
      days.push({ ...base, rest: true });
      continue;
    }
    if (active.length === 0) {
      days.push({ ...base, rest: true, done: true });
      continue;
    }

    // Steps 1 + 2: free slots for this day
    // A lighter (or heavier) day just this once changes how many sessions fit
    const maxToday = change.hours
      ? Math.max(1, Math.floor((change.hours * 60 + breakLen) / (sessionLen + breakLen)))
      : sessionsPerDay;
    const slots = findSlots(prefs, weekday, maxToday, iso);
    if (slots.length === 0) {
      days.push({ ...base, rest: false, noTime: true });
      continue;
    }

    // Step 4: urgency for THIS day
    const scored = active.map((s) => ({
      subject: s,
      score: Math.max(1, urgencyScore(s, date)),
      daysToExam: daysToDeadline(s, date),
    }));

    // Step 5: how many sessions each subject gets
    const counts = allocateSessions(scored, slots.length, lastStudied, i);

    // Step 6: put them in a good order, then give each one its slot time
    const order = orderSessions(counts, scored);
    const sessions = order.map((subjectId, k) => {
      const s = active.find((x) => x.id === subjectId);
      const daysToExam = daysToDeadline(s, date);
      lastStudied[subjectId] = i;
      return {
        subjectId,
        subjectName: s.name,
        color: s.color,
        start: minutesToTime(slots[k]),
        end: minutesToTime(slots[k] + sessionLen),
        startMin: slots[k], // minutes since midnight; can be over 1440 when past midnight
        endMin: slots[k] + sessionLen,
        // Exam week (last 3 days before the exam): revision only, no new chapters
        type: daysToExam <= 3 ? "Revision" : "Study",
      };
    });

    days.push({ ...base, rest: false, skippedRest, sessions });
  }

  return { days, sessionsPerDay, dayStart: prefs.dayStart, dayEnd: prefs.dayEnd };
}

// Shares `total` sessions between subjects based on their scores.
function allocateSessions(scored, total, lastStudied, dayIndex) {
  const counts = {};
  scored.forEach(({ subject }) => (counts[subject.id] = 0));
  let remaining = total;

  // Rule A: day-before-exam subject takes at least half the day.
  const examTomorrow = scored.filter((x) => x.daysToExam === 1);
  examTomorrow.forEach((x) => {
    const share = Math.max(1, Math.floor(total / 2 / examTomorrow.length));
    const give = Math.min(share, remaining);
    counts[x.subject.id] += give;
    remaining -= give;
  });

  // Rule B: anything not studied in the last 2 days gets 1 guaranteed session.
  scored
    .filter((x) => {
      const last = lastStudied[x.subject.id];
      return counts[x.subject.id] === 0 && (last === undefined || dayIndex - last >= 2);
    })
    .sort((a, b) => b.score - a.score)
    .forEach((x) => {
      if (remaining > 0) {
        counts[x.subject.id] += 1;
        remaining -= 1;
      }
    });

  if (remaining <= 0) return counts;

  // Proportional split of what's left ("largest remainder" method):
  // give each subject its fair share rounded down, then hand the
  // leftover sessions to whoever had the biggest fractional part.
  const totalScore = scored.reduce((sum, x) => sum + x.score, 0);
  const shares = scored.map((x) => {
    const exact = (x.score / totalScore) * remaining;
    return { id: x.subject.id, whole: Math.floor(exact), frac: exact % 1 };
  });
  let handedOut = 0;
  shares.forEach((s) => {
    counts[s.id] += s.whole;
    handedOut += s.whole;
  });
  shares
    .sort((a, b) => b.frac - a.frac)
    .slice(0, remaining - handedOut)
    .forEach((s) => (counts[s.id] += 1));

  return counts;
}

// Builds the session order: harder subjects first, never the same subject
// twice in a row (unless it's the only one left).
function orderSessions(counts, scored) {
  const left = { ...counts };
  const difficultyOf = {};
  scored.forEach((x) => (difficultyOf[x.subject.id] = x.subject.difficulty));

  const order = [];
  let last = null;
  const total = Object.values(left).reduce((a, b) => a + b, 0);

  for (let n = 0; n < total; n++) {
    const candidates = Object.keys(left)
      .filter((id) => left[id] > 0)
      .sort((a, b) => left[b] - left[a] || difficultyOf[b] - difficultyOf[a]);
    const pick = candidates.find((id) => id !== last) ?? candidates[0];
    order.push(pick);
    left[pick] -= 1;
    last = pick;
  }
  return order;
}
