// ─────────────────────────────────────────────────────────────
// THE GAME RULES
//
// XP (experience points):
//   • Finish a study session (quest)  -> 10 XP × the subject's difficulty
//                                        (difficulty 5 = 50 XP)
//   • Revision session (day before exam) -> +20 XP bonus
//   • Finish a chapter                 -> 30 XP
//
// Levels: each level needs 100 XP more than the one before.
//   Level 1 -> 2 needs 100 XP, level 2 -> 3 needs 200 XP, 3 -> 4 needs 300...
//   So total XP to REACH level n = 100 × (n-1) × n / 2
//
// Streak: how many days in a row (ending today or yesterday) you finished
// at least one quest.
//
// Everything is saved inside the plan as `progress`:
//   { xp, done: { "2026-10-03": [quest, ...] }, today: { date, quests } }
// ─────────────────────────────────────────────────────────────
import { toISODate, addDays, hasDeadline } from "./dates.js";

export const CHAPTER_XP = 30;
export const REVISION_BONUS = 20;

export function emptyProgress() {
  return { xp: 0, done: {}, today: null, planned: {}, skipped: [], quizXp: 0, cards: [], chapterLog: [], revDone: [], quizStats: {} };
}

export function normalizeProgress(p) {
  return {
    xp: Math.max(0, Number(p?.xp) || 0),
    done: p?.done && typeof p.done === "object" ? p.done : {},
    today: p?.today ?? null,
    planned: p?.planned && typeof p.planned === "object" ? p.planned : {},
    skipped: Array.isArray(p?.skipped) ? p.skipped : [],
    quizXp: Number(p?.quizXp) || 0,
    cards: Array.isArray(p?.cards) ? p.cards.filter((c) => c && c.front && c.back).slice(0, 1000) : [],
    chapterLog: Array.isArray(p?.chapterLog) ? p.chapterLog.slice(-400) : [],
    revDone: Array.isArray(p?.revDone) ? p.revDone.slice(-1200) : [],
    quizStats: p?.quizStats && typeof p.quizStats === "object" ? p.quizStats : {},
    xpLog: p?.xpLog && typeof p.xpLog === "object" ? p.xpLog : {},
  };
}

// ─────────────────────────────────────────────────────────────
// XP PER DAY (for the friends leaderboard: "XP this week")
// Any time your XP goes up (quest, revision, card, quiz...) the gain is
// added to today's entry; un-ticking takes it back. Kept for 30 days.
// ─────────────────────────────────────────────────────────────
export function logXpChange(prev, next, today = new Date()) {
  if (!prev?.progress || !next?.progress) return next;
  const delta = (next.progress.xp ?? 0) - (prev.progress.xp ?? 0);
  // Big jumps aren't "earned today" (e.g. loading a backup file)
  if (delta === 0 || Math.abs(delta) > 300) return next;
  const day = toISODate(today);
  const log = { ...(next.progress.xpLog ?? {}) };
  log[day] = Math.max(0, (log[day] ?? 0) + delta);
  const cutoff = toISODate(addDays(today, -30));
  for (const d of Object.keys(log)) if (d < cutoff) delete log[d];
  return { ...next, progress: { ...next.progress, xpLog: log } };
}

export function questXp(session, subject) {
  const base = 10 * (subject?.difficulty ?? 3);
  return base + (session.type === "Revision" ? REVISION_BONUS : 0);
}

// Total XP needed to reach `level`
export function xpForLevel(level) {
  return (100 * (level - 1) * level) / 2;
}

// 340 XP -> { level: 3, into: 40, needed: 300, pct: 13 }
export function levelInfo(xp) {
  let level = 1;
  while (xp >= xpForLevel(level + 1)) level++;
  const into = xp - xpForLevel(level);
  const needed = xpForLevel(level + 1) - xpForLevel(level);
  return { level, into, needed, pct: Math.round((into / needed) * 100) };
}

// A quest's ID: which subject, which day, what time
export function questKey(date, session) {
  return `${date}|${session.start}|${session.subjectId}`;
}

export function isDone(progress, date, session) {
  return (progress.done[date] ?? []).some((q) => q.key === questKey(date, session));
}

// Tick or untick a quest. Returns the new progress (never changes the old one).
export function toggleQuest(progress, date, session, subject) {
  const key = questKey(date, session);
  const list = progress.done[date] ?? [];
  const existing = list.find((q) => q.key === key);
  if (existing) {
    return {
      ...progress,
      xp: Math.max(0, progress.xp - existing.xp),
      done: { ...progress.done, [date]: list.filter((q) => q.key !== key) },
    };
  }
  const xp = questXp(session, subject);
  const quest = { key, subjectId: session.subjectId, subjectName: session.subjectName, start: session.start, end: session.end, xp };
  return { ...progress, xp: progress.xp + xp, done: { ...progress.done, [date]: [...list, quest] } };
}

// Mark a quest done only if it isn't already (used by the focus timer)
export function completeQuest(progress, date, session, subject) {
  return isDone(progress, date, session) ? progress : toggleQuest(progress, date, session, subject);
}

export function streak(progress, today = new Date()) {
  const has = (d) => (progress.done[toISODate(d)] ?? []).length > 0;
  // A streak still counts if today isn't done YET but yesterday was
  let day = has(today) ? today : addDays(today, -1);
  let count = 0;
  while (has(day)) {
    count++;
    day = addDays(day, -1);
  }
  return count;
}

export function totalQuestsDone(progress) {
  return Object.values(progress.done).reduce((n, list) => n + list.length, 0);
}

// ── Trophies ──
// Each one is a rule that's either true or not. Ones with a target also show
// how far along you are (e.g. 7 / 10), grouped so the cabinet is easy to read.
export const TROPHY_GROUPS = ["Sessions", "Streaks", "Study time", "Levels", "Bosses", "Cards & revision", "Quizzes", "Special"];

export function trophies(progress, subjects) {
  const all = Object.values(progress.done).flat();
  const st = streak(progress);
  const lvl = levelInfo(progress.xp).level;
  const bossesDown = subjects.filter((s) => s.chaptersDone >= s.totalChapters).length;
  const hour = (t) => Number(t.split(":")[0]);
  // 04:00-07:59 counts as early; 21:00-03:59 counts as late night
  const isEarly = (t) => hour(t) >= 4 && hour(t) < 8;
  const isLate = (t) => hour(t) >= 21 || hour(t) < 4;
  const hours = all.reduce((n, q) => n + questMinutes(q), 0) / 60;
  const best = bestStreak(progress);
  const days = Object.entries(progress.done).filter(([, l]) => l.length);
  const biggestDay = Math.max(0, ...days.map(([, l]) => l.length));
  const cards = progress.cards ?? [];
  const mastered = cards.filter((c) => c.box >= 4).length;
  const revisions = (progress.revDone ?? []).length;
  const chapters = (progress.chapterLog ?? []).length;
  const quizAll = Object.values(progress.quizStats ?? {}).flatMap((t) => Object.values(t));
  const quizRight = quizAll.reduce((n, x) => n + (x.right ?? 0), 0);
  const perfectTopic = quizAll.some((x) => x.total >= 5 && x.right === x.total);
  const weekendBoth = days.some(([d]) => {
    const day = new Date(d + "T12:00:00");
    return day.getDay() === 6 && progress.done[toISODate(addDays(day, 1))]?.length;
  });
  const comeback = comebackAfterBreak(progress);
  const steadyIds = new Set(subjects.filter((s) => !hasDeadline(s)).map((s) => s.id));
  const steadyDone = all.filter((q) => steadyIds.has(q.subjectId)).length;
  const fullCycle = fullRevisionCycle(progress);

  const t = (group, id, name, how, cur, goal) => ({ group, id, name, how, got: cur >= goal, progress: goal > 1 ? [Math.min(cur, goal), goal] : null });
  return [
    t("Sessions", "first", "First quest", "Finish your first study session", all.length, 1),
    t("Sessions", "ten", "On a roll", "Finish 10 study sessions", all.length, 10),
    t("Sessions", "fifty", "Grinder", "Finish 50 study sessions", all.length, 50),
    t("Sessions", "hundred", "Century", "Finish 100 study sessions", all.length, 100),
    t("Sessions", "twofifty", "Marathon", "Finish 250 study sessions", all.length, 250),
    t("Sessions", "bigday", "Big day", "Finish 6 sessions in one day", biggestDay, 6),
    t("Streaks", "s3", "3-day streak", "Study 3 days in a row", best, 3),
    t("Streaks", "s7", "Week warrior", "Study 7 days in a row", best, 7),
    t("Streaks", "s14", "Unstoppable", "Study 14 days in a row", best, 14),
    t("Streaks", "s30", "Iron will", "Study 30 days in a row", best, 30),
    t("Streaks", "comeback", "Comeback", "Study again after 3+ days off", comeback ? 1 : 0, 1),
    t("Study time", "h10", "Clocked in", "Study for 10 hours in total", Math.floor(hours), 10),
    t("Study time", "h50", "Deep worker", "Study for 50 hours in total", Math.floor(hours), 50),
    t("Study time", "h100", "Scholar", "Study for 100 hours in total", Math.floor(hours), 100),
    t("Levels", "lvl5", "Level 5", "Reach level 5", lvl, 5),
    t("Levels", "lvl10", "Level 10", "Reach level 10", lvl, 10),
    t("Levels", "lvl20", "Legend", "Reach level 20", lvl, 20),
    t("Bosses", "ch10", "Chapter chaser", "Finish 10 chapters", chapters, 10),
    t("Bosses", "ch50", "Bookworm", "Finish 50 chapters", chapters, 50),
    t("Bosses", "boss", "Boss down", "Finish every chapter of one subject", bossesDown, 1),
    t("Bosses", "boss3", "Boss slayer", "Finish every chapter of 3 subjects", bossesDown, 3),
    t("Bosses", "allboss", "Flawless", "Finish every chapter of every subject", subjects.length > 0 && bossesDown === subjects.length ? 1 : 0, 1),
    t("Cards & revision", "cards25", "Card collector", "Have 25 flashcards", cards.length, 25),
    t("Cards & revision", "master10", "Card master", "Master 10 flashcards (box 4 or higher)", mastered, 10),
    t("Cards & revision", "rev5", "Remember me", "Finish 5 revision rounds", revisions, 5),
    t("Cards & revision", "rev25", "Memory palace", "Finish 25 revision rounds", revisions, 25),
    t("Cards & revision", "cycle", "Full cycle", "Revise one chapter all 3 times (1, 3 and 7 days later)", fullCycle ? 1 : 0, 1),
    t("Quizzes", "quiz", "Quiz whiz", "Earn 50 XP from AI quizzes", progress.quizXp ?? 0, 50),
    t("Quizzes", "right25", "Sharpshooter", "Get 25 quiz questions right", quizRight, 25),
    t("Quizzes", "right100", "Mastermind", "Get 100 quiz questions right", quizRight, 100),
    t("Quizzes", "perfect", "Perfectionist", "Answer 5+ questions on one topic with no mistakes", perfectTopic ? 1 : 0, 1),
    t("Special", "early", "Early bird", "Finish a session that starts before 8:00", all.some((q) => isEarly(q.start)) ? 1 : 0, 1),
    t("Special", "owl", "Night owl", "Finish a session that starts between 21:00 and 04:00", all.some((q) => isLate(q.start)) ? 1 : 0, 1),
    t("Special", "weekend", "Weekend warrior", "Study on both Saturday and Sunday of a weekend", weekendBoth ? 1 : 0, 1),
    t("Special", "steady", "Steady learner", "Finish 10 sessions of a subject with no deadline", steadyDone, 10),
  ];
}

// Longest run of days in a row with at least one finished session (ever)
export function bestStreak(progress) {
  const dates = Object.keys(progress.done).filter((d) => progress.done[d]?.length).sort();
  let best = 0;
  let run = 0;
  let prev = null;
  for (const d of dates) {
    run = prev && toISODate(addDays(new Date(prev + "T12:00:00"), 1)) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return Math.max(best, streak(progress));
}

// Studied again after a gap of 3 or more days with nothing done
function comebackAfterBreak(progress) {
  const dates = Object.keys(progress.done).filter((d) => progress.done[d]?.length).sort();
  for (let i = 1; i < dates.length; i++) {
    const gap = Math.round((new Date(dates[i] + "T12:00:00") - new Date(dates[i - 1] + "T12:00:00")) / 86400000);
    if (gap > 3) return true;
  }
  return false;
}

// Some chapter has had all 3 revision rounds done
function fullRevisionCycle(progress) {
  const count = {};
  for (const key of progress.revDone ?? []) {
    const chapter = key.split("|").slice(0, 3).join("|");
    count[chapter] = (count[chapter] ?? 0) + 1;
    if (count[chapter] >= REVISION_STEPS.length) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────
// HISTORY: what was planned each day, so we can show missed quests and stats
// progress.planned = { "2026-10-03": [session, ...], ... }  (last 21 days kept)
// progress.skipped = [questKey, ...]  (missed quests you chose to ignore)
// ─────────────────────────────────────────────────────────────
export function rememberPlan(progress, date, sessions) {
  const planned = { ...(progress.planned ?? {}), [date]: sessions };
  const keep = Object.keys(planned).sort().slice(-21);
  return {
    ...progress,
    today: { date, sessions },
    planned: Object.fromEntries(keep.map((d) => [d, planned[d]])),
  };
}

// Quests from the last `days` days (not today) that weren't done or skipped
export function missedQuests(progress, today = new Date(), days = 3) {
  const skipped = new Set(progress.skipped ?? []);
  const nowMins = today.getHours() * 60 + today.getMinutes();
  const out = [];
  for (let i = days; i >= 1; i--) {
    const date = toISODate(addDays(today, -i));
    for (const s of progress.planned?.[date] ?? []) {
      // Yesterday's after-midnight sessions (e.g. 00:05) aren't missed until they've ended
      if (i === 1 && (s.endMin ?? 0) > 1440 + nowMins) continue;
      const key = questKey(date, s);
      if (!skipped.has(key) && !isDone(progress, date, s)) out.push({ date, session: s, key });
    }
  }
  return out;
}

export function skipQuest(progress, key) {
  return { ...progress, skipped: [...(progress.skipped ?? []), key].slice(-300) };
}

// Minutes a quest took (from its start/end times)
function questMinutes(q) {
  const [sh, sm] = q.start.split(":").map(Number);
  const [eh, em] = q.end.split(":").map(Number);
  let m = eh * 60 + em - (sh * 60 + sm);
  if (m <= 0) m += 1440; // ran past midnight
  return m;
}

// Numbers for the Progress tab
export function weeklyStats(progress, subjects, today = new Date()) {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const date = toISODate(addDays(today, -i));
    const done = progress.done[date] ?? [];
    days.push({
      date,
      minutes: done.reduce((n, q) => n + questMinutes(q), 0),
      xp: done.reduce((n, q) => n + q.xp, 0),
      quests: done.length,
      planned: (progress.planned?.[date] ?? []).length,
    });
  }
  const bySubject = {};
  days.forEach((d) =>
    (progress.done[d.date] ?? []).forEach((q) => {
      bySubject[q.subjectId] = (bySubject[q.subjectId] ?? 0) + questMinutes(q);
    })
  );
  const totalMinutes = days.reduce((n, d) => n + d.minutes, 0);
  const plannedCount = days.reduce((n, d) => n + d.planned, 0);
  const doneCount = days.reduce((n, d) => n + Math.min(d.quests, d.planned), 0);
  return {
    days,
    totalMinutes,
    completion: plannedCount ? Math.round((doneCount / plannedCount) * 100) : null,
    subjects: subjects
      .map((s) => ({ id: s.id, name: s.name, color: s.color, minutes: bySubject[s.id] ?? 0 }))
      .sort((a, b) => b.minutes - a.minutes),
  };
}


// ─────────────────────────────────────────────────────────────
// FLASHCARDS with spaced repetition (the "Leitner box" method)
//
// Every card sits in a box from 1 to 5. The box decides how many days
// until you see it again:   box 1 -> 1 day, 2 -> 2, 3 -> 4, 4 -> 7, 5 -> 14
//   Got it right?  -> moves up one box (you'll see it later and later)
//   Got it wrong?  -> back to box 1 (you'll see it again tomorrow)
// So easy cards fade into the background and hard ones keep coming back.
// ─────────────────────────────────────────────────────────────
export const BOX_DAYS = [1, 2, 4, 7, 14];
export const CARD_XP = 2;

export function newCard({ subjectId, topic, front, back }, today = new Date()) {
  return {
    id: crypto.randomUUID(),
    subjectId,
    topic: topic || "",
    front: String(front).trim().slice(0, 200),
    back: String(back).trim().slice(0, 400),
    box: 1,
    due: toISODate(today), // new cards are due straight away
    reviews: 0,
    lapses: 0,
  };
}

export function reviewCard(card, correct, today = new Date()) {
  const box = correct ? Math.min(5, card.box + 1) : 1;
  return {
    ...card,
    box,
    due: toISODate(addDays(today, BOX_DAYS[box - 1])),
    reviews: card.reviews + 1,
    lapses: card.lapses + (correct ? 0 : 1),
  };
}

export function dueCards(progress, today = new Date()) {
  const t = toISODate(today);
  return (progress.cards ?? []).filter((c) => c.due <= t);
}

// ─────────────────────────────────────────────────────────────
// REVISION ROUNDS
// When you finish a chapter it goes in progress.chapterLog with the date.
// It comes back as a short "revision" quest 1, 3 and 7 days later
// (spaced revision, so you still remember it on exam day).
// ─────────────────────────────────────────────────────────────
export const REVISION_STEPS = [1, 3, 7];
export const REVISION_XP = 15;

export function logChapter(progress, subjectId, name, date) {
  return { ...progress, chapterLog: [...(progress.chapterLog ?? []), { subjectId, name, date }].slice(-400) };
}

// Undo: remove the most recent log entry for that chapter
export function unlogChapter(progress, subjectId, name) {
  const log = [...(progress.chapterLog ?? [])];
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i].subjectId === subjectId && (name === null || log[i].name === name)) {
      log.splice(i, 1);
      break;
    }
  }
  return { ...progress, chapterLog: log };
}

const revKey = (e, step) => `${e.subjectId}|${e.name}|${e.date}|${step}`;

// Revisions due today (or overdue). For each chapter only the latest due
// step is shown, so a missed day-1 revision doesn't pile up with day-3.
export function revisionsDue(progress, subjects, today = new Date()) {
  const t = toISODate(today);
  const done = new Set(progress.revDone ?? []);
  const out = [];
  for (const e of progress.chapterLog ?? []) {
    const subject = subjects.find((s) => s.id === e.subjectId);
    if (!subject || (hasDeadline(subject) && subject.examDate < t)) continue; // exam over: no point revising
    let pick = null;
    for (const step of REVISION_STEPS) {
      const due = toISODate(addDays(new Date(e.date + "T12:00:00"), step));
      if (due <= t && !done.has(revKey(e, step))) pick = { ...e, step, key: revKey(e, step), subject };
    }
    if (pick) out.push(pick);
  }
  return out;
}

// Mark a revision done (and any earlier steps of the same chapter)
export function completeRevision(progress, item) {
  const keys = REVISION_STEPS.filter((st) => st <= item.step).map((st) => revKey(item, st));
  return {
    ...progress,
    xp: progress.xp + REVISION_XP,
    revDone: [...new Set([...(progress.revDone ?? []), ...keys])].slice(-1200),
  };
}

// ─────────────────────────────────────────────────────────────
// QUIZ SCORES per chapter -> "weak chapters" for exam week
// progress.quizStats = { subjectId: { "LCS": { right: 3, total: 5 } } }
// ─────────────────────────────────────────────────────────────
export function recordQuiz(progress, subjectId, topic, correct) {
  const name = topic || "General";
  const subj = { ...(progress.quizStats?.[subjectId] ?? {}) };
  const cur = subj[name] ?? { right: 0, total: 0 };
  subj[name] = { right: cur.right + (correct ? 1 : 0), total: cur.total + 1 };
  return { ...progress, quizStats: { ...(progress.quizStats ?? {}), [subjectId]: subj } };
}

// Chapters you score badly on (under 60%), worst first.
// Finished chapters never quizzed come after, so you know to test yourself on them.
export function weakChapters(progress, subject) {
  const stats = progress.quizStats?.[subject.id] ?? {};
  const scored = Object.entries(stats)
    .filter(([, v]) => v.total >= 1)
    .map(([name, v]) => ({ name, pct: Math.round((v.right / v.total) * 100), total: v.total }))
    .filter((x) => x.pct < 60)
    .sort((a, b) => a.pct - b.pct);
  // Untested = chapters you've FINISHED but never quizzed yourself on
  const untested = (subject.topics ?? []).filter((t) => t.done && !stats[t.name]).map((t) => ({ name: t.name, pct: null }));
  return [...scored, ...untested].slice(0, 6);
}

// Exam week = exam in 1 to 3 days
export const EXAM_WEEK_DAYS = 3;
export function examWeekSubjects(subjects, today = new Date()) {
  return subjects
    .filter(hasDeadline)
    .map((s) => ({ s, days: Math.round((new Date(s.examDate + "T00:00:00") - new Date(toISODate(today) + "T00:00:00")) / 86400000) }))
    .filter((x) => x.days >= 1 && x.days <= EXAM_WEEK_DAYS)
    .sort((a, b) => a.days - b.days);
}
