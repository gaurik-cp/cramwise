// Quick changes to your timetable, right from the dashboard (no setup wizard).
//   "Just this once"  one date: take it off, block out a few hours, study less/more
//   "Every week"      study hours, session length, breaks, study window, rest days,
//                     classes & meals
// Every change applies straight away and the timetable rebuilds itself.
import { useEffect, useState } from "react";
import WeekEditor from "./WeekEditor.jsx";
import { addDays, formatDay, parseISODate, toISODate } from "../utils/dates.js";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ORDER = [1, 2, 3, 4, 5, 6, 0];
const SESSION_CHOICES = [25, 45, 50, 60, 90];
const BREAK_CHOICES = [0, 5, 10, 15, 20];

export default function QuickAdjust({ prefs, onChange, aiState, only }) {
  const todayISO = toISODate(new Date());
  const tomorrowISO = toISODate(addDays(new Date(), 1));
  const [day, setDay] = useState(todayISO);
  const [busyDraft, setBusyDraft] = useState({ label: "", start: "16:00", end: "18:00" });
  const [error, setError] = useState("");
  const [weekOpen, setWeekOpen] = useState(false);

  const changes = prefs.changes ?? {};
  const change = changes[day] ?? {};
  const hoursThatDay = change.hours ?? prefs.hoursPerDay;

  // Save the one-off change for `day` (an empty change removes the date)
  function setChange(next) {
    setError("");
    const all = { ...changes };
    const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length)));
    if (Object.keys(clean).length) all[day] = clean;
    else delete all[day];
    onChange({ ...prefs, changes: all });
  }

  function addBusyOnce() {
    if (!busyDraft.start || !busyDraft.end) return setError("Fill in both times.");
    if (busyDraft.start >= busyDraft.end) return setError("The end time has to be after the start time (same day).");
    const block = { id: crypto.randomUUID(), label: busyDraft.label.trim() || "Busy", start: busyDraft.start, end: busyDraft.end };
    setChange({ ...change, busy: [...(change.busy ?? []), block] });
    setBusyDraft({ label: "", start: busyDraft.end, end: busyDraft.end < "23:00" ? plusHours(busyDraft.end, 2) : "23:59" });
  }

  const setWeekly = (k, v) => onChange({ ...prefs, [k]: v });
  function toggleRest(d) {
    const restDays = prefs.restDays.includes(d) ? prefs.restDays.filter((x) => x !== d) : [...prefs.restDays, d];
    if (restDays.length < 7) setWeekly("restDays", restDays);
  }

  const upcoming = Object.entries(changes).sort(([a], [b]) => a.localeCompare(b));
  const dayName = day === todayISO ? "today" : day === tomorrowISO ? "tomorrow" : formatDay(parseISODate(day));

  return (
    <div className={`qa ${only ? "qa-single" : ""}`}>
      {only !== "week" && (
        <section className="qa-card">
          <div className="qa-head">
            <h3 className="qa-title">Something came up?</h3>
            <p className="muted qa-sub">Change one day. The rest of your plan stays as it is.</p>
          </div>

          <div className="qa-days" role="group" aria-label="Which day">
            <button className={day === todayISO ? "on" : ""} onClick={() => setDay(todayISO)}>
              Today
            </button>
            <button className={day === tomorrowISO ? "on" : ""} onClick={() => setDay(tomorrowISO)}>
              Tomorrow
            </button>
            <input
              type="date"
              className="input qa-date"
              min={todayISO}
              value={day}
              aria-label="Pick a day"
              onChange={(e) => e.target.value && e.target.value >= todayISO && setDay(e.target.value)}
            />
          </div>

          <div className="qa-actions">
            <button
              className={`qa-toggle ${change.off ? "is-on" : ""}`}
              aria-pressed={Boolean(change.off)}
              onClick={() => setChange({ ...change, off: change.off ? undefined : true })}
            >
              <span className="qa-toggle-dot" />
              {change.off ? `Day off ${dayName}` : `Take ${dayName} off`}
            </button>

            {!change.off && (
              <div className="qa-row">
                <span className="qa-label">Study hours {dayName}</span>
                <Stepper
                  value={hoursThatDay}
                  min={1}
                  max={14}
                  onChange={(h) => setChange({ ...change, hours: h === prefs.hoursPerDay ? undefined : h })}
                />
                {change.hours && (
                  <button className="link-btn" onClick={() => setChange({ ...change, hours: undefined })}>
                    Back to usual ({prefs.hoursPerDay})
                  </button>
                )}
              </div>
            )}

            {!change.off && (
              <div className="qa-busy">
                <span className="qa-label">Busy {dayName}</span>
                <input
                  className="input"
                  placeholder="What? (optional)"
                  value={busyDraft.label}
                  onChange={(e) => setBusyDraft({ ...busyDraft, label: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && addBusyOnce()}
                />
                <input type="time" className="input" aria-label="From" value={busyDraft.start} onChange={(e) => setBusyDraft({ ...busyDraft, start: e.target.value })} />
                <span className="muted">to</span>
                <input type="time" className="input" aria-label="To" value={busyDraft.end} onChange={(e) => setBusyDraft({ ...busyDraft, end: e.target.value })} />
                <button className="btn btn-ghost btn-small" onClick={addBusyOnce}>
                  Block it out
                </button>
              </div>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </div>

          {upcoming.length > 0 && (
            <ul className="qa-list" aria-label="Your one-off changes">
              {upcoming.map(([date, c]) => (
                <li key={date}>
                  <button className="qa-list-day" onClick={() => setDay(date)}>
                    {date === todayISO ? "Today" : date === tomorrowISO ? "Tomorrow" : formatDay(parseISODate(date))}
                  </button>
                  <span className="qa-list-what">{describe(c)}</span>
                  <button
                    className="link-btn"
                    onClick={() => {
                      const all = { ...changes };
                      delete all[date];
                      onChange({ ...prefs, changes: all });
                    }}
                  >
                    Undo
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {only !== "once" && (
        <section className="qa-card">
          <div className="qa-head">
            <h3 className="qa-title">Every week</h3>
            <p className="muted qa-sub">Your usual routine. Tap and the timetable rebuilds.</p>
          </div>

          <div className="qa-grid">
            <div className="qa-row">
              <span className="qa-label">Study hours a day</span>
              <Stepper value={prefs.hoursPerDay} min={1} max={14} onChange={(h) => setWeekly("hoursPerDay", h)} />
            </div>

            <div className="qa-row">
              <span className="qa-label">Session length</span>
              <Seg choices={SESSION_CHOICES} value={prefs.sessionLength} unit="m" onChange={(v) => setWeekly("sessionLength", v)} />
            </div>

            <div className="qa-row">
              <span className="qa-label">Break</span>
              <Seg choices={BREAK_CHOICES} value={prefs.breakLength} unit="m" onChange={(v) => setWeekly("breakLength", v)} />
            </div>

            <div className="qa-row">
              <span className="qa-label">Study between</span>
              <input type="time" className="input qa-time" aria-label="Earliest start" value={prefs.dayStart} onChange={(e) => e.target.value && setWeekly("dayStart", e.target.value)} />
              <span className="muted">and</span>
              <input type="time" className="input qa-time" aria-label="Latest finish" value={prefs.dayEnd} onChange={(e) => e.target.value && setWeekly("dayEnd", e.target.value)} />
            </div>

            <div className="qa-row">
              <span className="qa-label">Rest days</span>
              <div className="days">
                {ORDER.map((d) => (
                  <button key={d} aria-pressed={prefs.restDays.includes(d)} className={prefs.restDays.includes(d) ? "on-solid" : ""} onClick={() => toggleRest(d)}>
                    {WEEKDAYS[d]}
                  </button>
                ))}
              </div>
            </div>

            <div className="qa-row">
              <span className="qa-label">Classes, labs & meals</span>
              <button className="btn btn-ghost btn-small" onClick={() => setWeekOpen(true)}>
                {prefs.busy.length ? `Edit (${prefs.busy.length})` : "Add your timetable"}
              </button>
            </div>
          </div>
        </section>
      )}

      {weekOpen && (
        <WeekModal prefs={prefs} onChange={onChange} aiState={aiState} onClose={() => setWeekOpen(false)} />
      )}
    </div>
  );
}

// Classes/labs/meals editor in a pop-up (same editor as setup, changes save live)
function WeekModal({ prefs, onChange, aiState, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-xwide" role="dialog" aria-modal="true" aria-labelledby="week-modal-title">
        <div className="title-row">
          <h2 id="week-modal-title" className="panel-title">
            Classes, labs & meals
          </h2>
          <button className="btn btn-primary btn-small" onClick={onClose}>
            Done
          </button>
        </div>
        <p className="muted small-gap">Changes save as you go. Study sessions never land on top of these.</p>
        <WeekEditor
          busy={prefs.busy}
          setBusy={(busy) => onChange({ ...prefs, busy })}
          dayStart={prefs.dayStart}
          dayEnd={prefs.dayEnd}
          aiState={aiState}
          batchHint={prefs.batchHint ?? ""}
          setBatchHint={(batchHint) => onChange({ ...prefs, batchHint })}
        />
      </div>
    </div>
  );
}

function Stepper({ value, min, max, onChange }) {
  return (
    <div className="stepper">
      <button aria-label="Less" disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>
        −
      </button>
      <span className="stepper-val">{value}h</span>
      <button aria-label="More" disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>
        +
      </button>
    </div>
  );
}

function Seg({ choices, value, unit, onChange }) {
  // Keep a custom value from setup visible as its own option
  const all = choices.includes(value) ? choices : [...choices, value].sort((a, b) => a - b);
  return (
    <div className="seg">
      {all.map((c) => (
        <button key={c} className={c === value ? "on" : ""} aria-pressed={c === value} onClick={() => onChange(c)}>
          {c}
          {unit}
        </button>
      ))}
    </div>
  );
}

function describe(c) {
  if (c.off) return "Day off";
  const parts = [];
  if (c.hours) parts.push(`${c.hours}h of study`);
  (c.busy ?? []).forEach((b) => parts.push(`${b.label} ${b.start}–${b.end}`));
  return parts.join(" · ");
}

function plusHours(t, h) {
  const [hh, mm] = t.split(":").map(Number);
  return `${String(Math.min(23, hh + h)).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
