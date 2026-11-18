// The timetable as a day view: one strip per day, left = morning, right = night.
// Grey blocks = your fixed week (classes, labs, work, meals). Coloured = study.
// A yellow line on today's strip shows the time right now.
// On phones the CSS shows each day as a simple list instead.
import { useEffect, useState } from "react";
import { formatDay, formatTime, parseISODate, toISODate, timeToMinutes } from "../utils/dates.js";

// Ticks every minute so the "now" line moves
function useNowMinutes() {
  const get = () => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  };
  const [mins, setMins] = useState(get);
  useEffect(() => {
    const t = setInterval(() => setMins(get()), 60000);
    return () => clearInterval(t);
  }, []);
  return mins;
}

export default function Timetable({ timetable }) {
  const today = toISODate(new Date());
  const nowMins = useNowMinutes();

  // Times as minutes since midnight. Study sessions carry startMin/endMin,
  // which go past 1440 when the study window runs after midnight.
  const sStart = (s) => s.startMin ?? timeToMinutes(s.start);
  const sEnd = (s) => s.endMin ?? timeToMinutes(s.end);
  const winStart = timeToMinutes(timetable.dayStart);
  let winEnd = timeToMinutes(timetable.dayEnd);
  if (winEnd <= winStart) winEnd += 1440;

  // The strip covers from the earliest thing in the plan to the latest
  const starts = timetable.days.flatMap((d) => [...d.sessions.map(sStart), ...d.busy.map((b) => timeToMinutes(b.start))]);
  const ends = timetable.days.flatMap((d) => [...d.sessions.map(sEnd), ...d.busy.map((b) => timeToMinutes(b.end))]);
  const from = Math.floor(Math.min(winStart, ...starts) / 60) * 60;
  const to = Math.ceil(Math.max(winEnd, ...ends) / 60) * 60;
  const span = Math.max(60, to - from);
  const pct = (m) => `${((m - from) / span) * 100}%`;
  const pos = (t) => pct(timeToMinutes(t));
  const width = (a, b) => `${((timeToMinutes(b) - timeToMinutes(a)) / span) * 100}%`;

  const hours = [];
  for (let m = from; m <= to; m += 60) hours.push(m);
  const hourStep = span > 14 * 60 ? 2 : 1; // fewer labels when the day is long

  return (
    <div className="dv">
      <div className="dv-hours" aria-hidden="true">
        <span className="dv-label" />
        <div className="dv-track">
          {hours.map((m, i) =>
            i % hourStep === 0 ? (
              <span key={m} className="dv-hour" style={{ left: `${((m - from) / span) * 100}%` }}>
                {String(Math.floor(m / 60) % 24).padStart(2, "0")}
              </span>
            ) : null
          )}
        </div>
      </div>

      {timetable.days.map((day) => {
        const isToday = day.date === today;
        // Everything happening that day, in time order (used by the phone list)
        const items = [
          ...day.busy.map((b) => ({ ...b, isBusy: true })),
          ...day.sessions.map((s) => ({ ...s, isBusy: false })),
        ].sort((a, b) => (a.isBusy ? timeToMinutes(a.start) : sStart(a)) - (b.isBusy ? timeToMinutes(b.start) : sStart(b)));

        return (
          <div key={day.date} className={`dv-row ${isToday ? "is-today" : ""} ${day.rest ? "is-rest" : ""}`}>
            <div className="dv-label">
              <span className="dv-date">{formatDay(parseISODate(day.date))}</span>
              {isToday && <span className="today-mark">Today</span>}
              {day.skippedRest && <span className="tt-note">Day off moved: exam tomorrow</span>}
              {day.rest && <span className="dv-sub">{day.done ? "No exams left" : "Day off"}</span>}
              {day.changed && <span className="tt-note tt-once">Changed just this day</span>}
              {day.noTime && <span className="dv-sub">No free time to study</span>}
            </div>

            <div className="dv-track">
              {hours.map((m) => (
                <i key={m} className="dv-grid" style={{ left: `${((m - from) / span) * 100}%` }} />
              ))}

              {day.busy.map((b) => (
                <span
                  key={b.id}
                  className={`dv-busy kind-${b.kind}`}
                  style={{ left: pos(b.start), width: width(b.start, b.end) }}
                  title={`${b.label}, ${b.start}–${b.end}`}
                >
                  <span className="dv-text">{b.label}</span>
                </span>
              ))}

              {day.sessions.map((s) => (
                <span
                  key={s.start}
                  className={`dv-session ${s.type === "Revision" ? "is-rev" : ""}`}
                  style={{ left: pct(sStart(s)), width: `${((sEnd(s) - sStart(s)) / span) * 100}%`, "--ink": s.color }}
                  title={`${s.subjectName} ${s.type === "Revision" ? "revision" : ""}, ${s.start}–${s.end}`}
                >
                  <span className="dv-text">{s.subjectName}</span>
                </span>
              ))}

              {isToday && nowMins >= from && nowMins <= to && (
                <i className="dv-now" style={{ left: `${((nowMins - from) / span) * 100}%` }} />
              )}
            </div>

            {/* phone layout: a plain list */}
            <ul className="dv-list">
              {items.map((it) => (
                <li key={(it.isBusy ? "b" : "s") + it.start + (it.id ?? "")} className={it.isBusy ? "is-busy" : ""}>
                  <span className="dv-list-time">
                    {formatTime(it.start)}–{formatTime(it.end)}
                  </span>
                  {it.isBusy ? (
                    <span className="dv-list-busy">{it.label}</span>
                  ) : (
                    <span className="dv-list-study" style={{ "--ink": it.color }}>
                      {it.subjectName}
                      {it.type === "Revision" && <em> revision</em>}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
