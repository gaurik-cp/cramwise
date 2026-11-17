// Exports the timetable to a PDF using jsPDF + the autoTable plugin.
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { formatDay, parseISODate } from "./dates.js";
import { urgencyBreakdown, urgencyLevel } from "./urgency.js";

// "#8b7bff" -> [139, 123, 255]   (jsPDF wants colours as RGB numbers)
function hexToRgb(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function exportTimetablePDF({ userName, subjects, timetable }) {
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();

  // Header band
  doc.setFillColor(24, 26, 31);
  doc.rect(0, 0, pageWidth, 90, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(24);
  doc.text("Cramwise", 40, 48);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(
    `Study plan for ${userName || "you"}, made on ${new Date().toLocaleDateString("en-IN")}`,
    40,
    70
  );

  // Subject urgency summary
  doc.setTextColor(30, 30, 30);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Subjects by urgency", 40, 125);

  const subjectRows = [...subjects]
    .map((s) => ({ s, u: urgencyBreakdown(s) }))
    .sort((a, b) => b.u.score - a.u.score)
    .map(({ s, u }) => [
      s.name,
      formatDay(parseISODate(s.examDate)),
      `${u.daysLeft}`,
      `${u.chaptersLeft}`,
      `${s.difficulty}/5`,
      `${u.score} (${urgencyLevel(u.score).label})`,
    ]);

  autoTable(doc, {
    startY: 135,
    head: [["Subject", "Exam", "Days left", "Chapters left", "Difficulty", "Urgency"]],
    body: subjectRows,
    headStyles: { fillColor: [39, 42, 50], textColor: [243, 211, 74] },
    styles: { fontSize: 10 },
  });

  // Day-by-day timetable
  let y = doc.lastAutoTable.finalY + 30;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Timetable", 40, y);

  const rows = [];
  timetable.days.forEach((day) => {
    const label = formatDay(parseISODate(day.date));
    if (day.rest) {
      rows.push([label, "", day.done ? "No exams left" : "Day off", ""]);
      return;
    }
    day.sessions.forEach((s, i) => {
      rows.push([i === 0 ? label : "", `${s.start}-${s.end}`, s.subjectName, s.type, s.color]);
    });
  });

  autoTable(doc, {
    startY: y + 10,
    head: [["Day", "Time", "Subject", "Type"]],
    body: rows.map((r) => r.slice(0, 4)),
    headStyles: { fillColor: [39, 42, 50], textColor: [243, 211, 74] },
    styles: { fontSize: 10 },
    // Colour a little strip on the subject cell to match the app
    didParseCell: (data) => {
      if (data.section === "body" && data.column.index === 2) {
        const color = rows[data.row.index][4];
        if (color) data.cell.styles.textColor = hexToRgb(color);
        data.cell.styles.fontStyle = "bold";
      }
    },
  });

  doc.save("cramwise-timetable.pdf");
}
