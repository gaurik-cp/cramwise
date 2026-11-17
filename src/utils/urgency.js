// ─────────────────────────────────────────────────────────────
// URGENCY SCORING
// Gives every subject a score from 0 to 100.
// Higher score = "study this more, and sooner".
//
// It mixes THREE factors, each turned into a number between 0 and 1:
//
//   1. Deadline factor  — how close is the exam?
//        1 / (1 + daysLeft / 7)
//        exam today   -> 1.00
//        in 7 days    -> 0.50
//        in 21 days   -> 0.25
//
//   2. Difficulty factor — how hard you said it is (1 to 5)
//        difficulty / 5        e.g. 4 -> 0.8
//
//   3. Load factor — how many chapters you must finish PER DAY
//        chaptersPerDay = chaptersLeft / daysLeft
//        capped so 2+ chapters a day = 1.0 (maximum pressure)
//
// Final score = 100 × (0.45·deadline + 0.25·difficulty + 0.30·load)
// The weights add up to 1, so the score can never go above 100.
// ─────────────────────────────────────────────────────────────

import { daysBetween, parseISODate } from "./dates.js";

export const WEIGHTS = { deadline: 0.45, difficulty: 0.25, load: 0.3 };

export function urgencyBreakdown(subject, onDate = new Date()) {
  const examDate = parseISODate(subject.examDate);
  // At least 1 day, so we never divide by zero.
  const daysLeft = Math.max(1, daysBetween(onDate, examDate));
  const chaptersLeft = Math.max(0, subject.totalChapters - subject.chaptersDone);

  const deadline = 1 / (1 + daysLeft / 7);
  const difficulty = subject.difficulty / 5;
  const chaptersPerDay = chaptersLeft / daysLeft;
  const load = Math.min(1, chaptersPerDay / 2);

  let score =
    100 *
    (WEIGHTS.deadline * deadline +
      WEIGHTS.difficulty * difficulty +
      WEIGHTS.load * load);

  // Everything already done? Keep only a small "revision" score.
  if (chaptersLeft === 0) score = Math.min(score, 15);

  return {
    score: Math.round(score),
    daysLeft,
    chaptersLeft,
    chaptersPerDay,
    factors: { deadline, difficulty, load },
  };
}

export function urgencyScore(subject, onDate) {
  return urgencyBreakdown(subject, onDate).score;
}

// Turns a number into a label + colour for the UI.
export function urgencyLevel(score) {
  if (score >= 70) return { label: "Critical", color: "#ef7a68" };
  if (score >= 50) return { label: "High", color: "#e9b25f" };
  if (score >= 30) return { label: "Medium", color: "#c9c3b4" };
  return { label: "Low", color: "#86c29b" };
}
