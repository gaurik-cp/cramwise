// Makes a .ics calendar file of your study sessions and exams.
// Google Calendar, Outlook and Apple Calendar can all import .ics files.
// (Google Calendar: Settings -> Import & export -> Import.)

import { toISODate } from "./dates.js";

const pad = (n) => String(n).padStart(2, "0");

// 2026-10-03 + 1050 minutes -> "20261003T173000" (local time, no timezone,
// so the calendar app uses YOUR timezone)
function stamp(dateISO, minutes) {
  const [y, m, d] = dateISO.split("-").map(Number);
  const dt = new Date(y, m - 1, d, 0, minutes);
  return `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}T${pad(dt.getHours())}${pad(dt.getMinutes())}00`;
}

// Text in .ics files must escape commas, semicolons and backslashes
const esc = (t) => String(t).replace(/\\/g, "\\\\").replace(/([,;])/g, "\\$1").replace(/\n/g, "\\n");

export function buildIcs(timetable, subjects) {
  const toMin = (t) => {
    const [h, mm] = t.split(":").map(Number);
    return h * 60 + mm;
  };
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Cramwise//Study plan//EN", "CALSCALE:GREGORIAN"];
  const now = stamp(toISODate(new Date()), 0);

  timetable.days.forEach((day) => {
    day.sessions.forEach((s, i) => {
      const start = s.startMin ?? toMin(s.start);
      const end = s.endMin ?? toMin(s.end);
      lines.push(
        "BEGIN:VEVENT",
        `UID:cramwise-${day.date}-${i}-${s.subjectId}@cramwise`,
        `DTSTAMP:${now}`,
        `DTSTART:${stamp(day.date, start)}`,
        `DTEND:${stamp(day.date, end)}`,
        `SUMMARY:${esc(`Study: ${s.subjectName}${s.type === "Revision" ? " (revision)" : ""}`)}`,
        "BEGIN:VALARM",
        "TRIGGER:-PT5M",
        "ACTION:DISPLAY",
        `DESCRIPTION:${esc(`${s.subjectName} in 5 minutes`)}`,
        "END:VALARM",
        "END:VEVENT"
      );
    });
  });

  subjects.forEach((s) => {
    const d = s.examDate.replace(/-/g, "");
    lines.push(
      "BEGIN:VEVENT",
      `UID:cramwise-exam-${s.id}@cramwise`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${d}`,
      `SUMMARY:${esc(`EXAM: ${s.name}`)}`,
      "END:VEVENT"
    );
  });

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

export function downloadIcs(timetable, subjects) {
  const blob = new Blob([buildIcs(timetable, subjects)], { type: "text/calendar" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "cramwise-study-plan.ics";
  a.click();
  URL.revokeObjectURL(url);
}
