// Saving and loading plan files (.json) so you can back up your plan,
// move it to another browser, or load a week someone made for you.
//
// Two kinds of file:
//   1. A whole plan:  { "type": "cramwise-plan", userName, subjects, prefs }
//   2. Just a week:   { "type": "cramwise-week", busy: [ ...fixed blocks ] }
//      (classes, labs, mess timings). This gets ADDED to your plan.

const KINDS = ["class", "lab", "meal", "other"];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

// Makes sure every fixed block looks right, and drops broken ones.
export function cleanBlocks(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter(
      (b) =>
        b &&
        typeof b.label === "string" &&
        TIME.test(b.start) &&
        TIME.test(b.end) &&
        b.start < b.end &&
        Array.isArray(b.days) &&
        b.days.length > 0
    )
    .map((b) => ({
      id: b.id ?? crypto.randomUUID(),
      label: b.label.trim().slice(0, 40) || "Busy",
      kind: KINDS.includes(b.kind) ? b.kind : "other",
      days: [...new Set(b.days.map(Number).filter((d) => d >= 0 && d <= 6))],
      start: b.start,
      end: b.end,
    }))
    .filter((b) => b.days.length > 0);
}

// Reads a File the user picked and returns what's inside.
export async function readPlanFile(file) {
  let json;
  try {
    json = JSON.parse(await file.text());
  } catch {
    throw new Error("That file isn't a Cramwise plan file (it couldn't be read as JSON).");
  }
  if (json?.type === "cramwise-week") {
    const busy = cleanBlocks(json.busy);
    if (busy.length === 0) throw new Error("That week file has no valid blocks in it.");
    return { kind: "week", busy };
  }
  if (json?.type === "cramwise-plan" && Array.isArray(json.subjects) && json.prefs) {
    return {
      kind: "plan",
      data: {
        userName: String(json.userName ?? ""),
        subjects: json.subjects,
        prefs: { ...json.prefs, busy: cleanBlocks(json.prefs.busy) },
        progress: json.progress ?? undefined,
      },
    };
  }
  throw new Error("That file isn't a Cramwise plan or week file.");
}

// Downloads the current plan as a .json file.
export function downloadPlan(data) {
  const blob = new Blob([JSON.stringify({ type: "cramwise-plan", ...data }, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "cramwise-plan.json";
  a.click();
  URL.revokeObjectURL(url);
}
