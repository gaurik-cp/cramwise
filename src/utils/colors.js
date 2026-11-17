// Subject colours: bright arcade colours, one per subject.
// (Lime is kept for XP and gold for streaks, so they're not used here.)
export const SUBJECT_INKS = [
  "#4fd8ff", // cyan
  "#ff6bd6", // pink
  "#ff9a3c", // orange
  "#a98bff", // violet
  "#4dffb0", // mint
  "#ff6b6b", // coral
  "#6b9dff", // sky blue
];

export function inkFor(index) {
  return SUBJECT_INKS[index % SUBJECT_INKS.length];
}

// Older saved plans used the previous colour set. This swaps them
// to the new inks (by position) so everything matches.
export function migrateColors(data) {
  if (!data?.subjects) return data;
  return {
    ...data,
    subjects: data.subjects.map((s, i) =>
      SUBJECT_INKS.includes(s.color) ? s : { ...s, color: inkFor(i) }
    ),
  };
}
