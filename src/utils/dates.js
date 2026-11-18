// Small date helpers so the rest of the code stays readable.

// Returns a Date set to midnight (so "days between" math isn't thrown off by hours).
export function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

// Whole days from `from` to `to`. Example: today -> tomorrow = 1.
export function daysBetween(from, to) {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((startOfDay(to) - startOfDay(from)) / MS_PER_DAY);
}

export function addDays(d, n) {
  const x = startOfDay(d);
  x.setDate(x.getDate() + n);
  return x;
}

// "2026-10-28" -> Date (parsed as LOCAL time, not UTC, to avoid off-by-one bugs)
export function parseISODate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function toISODate(d) {
  const x = new Date(d);
  const mm = String(x.getMonth() + 1).padStart(2, "0");
  const dd = String(x.getDate()).padStart(2, "0");
  return `${x.getFullYear()}-${mm}-${dd}`;
}

// Dates and times are shown the way the person's own country writes them
// (the browser knows: 5 Dec in India/UK, Dec 5 in the US, and so on).
export function formatDay(d) {
  return new Date(d).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

// 540 -> "09:00"
export function minutesToTime(mins) {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// "09:00" -> 540
export function timeToMinutes(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

// "14:30" -> "2:30 PM" in the US/India, "14:30" in most of Europe
export function formatTime(t) {
  if (!t || !/^\d{2}:\d{2}$/.test(t)) return t || "";
  const [h, m] = t.split(":").map(Number);
  return new Date(2000, 0, 1, h % 24, m).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

// ─── Subjects without an exam or deadline ───
// examDate is "" for things you're just learning (e.g. "Learn Python").
// They're planned at a steady pace, as if the deadline were always a month away.
export const STEADY_PACE_DAYS = 30;
export function hasDeadline(subject) {
  return typeof subject?.examDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(subject.examDate);
}
// Days from `from` until this subject's exam (Infinity when there's no deadline)
export function daysToDeadline(subject, from = new Date()) {
  return hasDeadline(subject) ? daysBetween(from, parseISODate(subject.examDate)) : Infinity;
}
