// Progress tab, part 1: how much you studied this week.
//   • hours studied in the last 7 days
//   • a bar chart of minutes per day (taller = more), today highlighted
//   • how many planned quests you actually did
//   • which subjects got your time
import { weeklyStats, streak } from "../utils/game.js";
import { formatDay, parseISODate } from "../utils/dates.js";

function hm(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

export default function Stats({ progress, subjects }) {
  const st = weeklyStats(progress, subjects);
  const max = Math.max(60, ...st.days.map((d) => d.minutes));
  const subjectMax = Math.max(1, ...st.subjects.map((s) => s.minutes));

  return (
    <div className="stats">
      <div className="stat-cards">
        <div className="stat-card">
          <span className="stat-big">{hm(st.totalMinutes)}</span>
          <span className="stat-label">studied in the last 7 days</span>
        </div>
        <div className="stat-card">
          <span className="stat-big">{st.completion === null ? "–" : `${st.completion}%`}</span>
          <span className="stat-label">of planned quests done</span>
        </div>
        <div className="stat-card">
          <span className="stat-big">{streak(progress)}</span>
          <span className="stat-label">day streak</span>
        </div>
        <div className="stat-card">
          <span className="stat-big">{progress.xp}</span>
          <span className="stat-label">total XP</span>
        </div>
      </div>

      <div className="chart-card">
        <h3 className="chart-title">Minutes studied per day</h3>
        <div className="chart" role="img" aria-label="Bar chart of minutes studied over the last 7 days">
          {st.days.map((d, i) => (
            <div key={d.date} className={`bar-col ${i === 6 ? "is-today" : ""}`} title={`${formatDay(parseISODate(d.date))}: ${hm(d.minutes)}, ${d.quests} quests`}>
              <span className="bar-val">{d.minutes ? hm(d.minutes) : ""}</span>
              <div className="bar" style={{ height: `${(d.minutes / max) * 100}%` }} />
              <span className="bar-day">{i === 6 ? "Today" : parseISODate(d.date).toLocaleDateString("en-IN", { weekday: "short" })}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="chart-card">
        <h3 className="chart-title">Time per subject this week</h3>
        {st.totalMinutes === 0 ? (
          <p className="muted">Finish a quest and it shows up here.</p>
        ) : (
          <ul className="split">
            {st.subjects.map((s) => (
              <li key={s.id} style={{ "--ink": s.color }}>
                <span className="split-name">{s.name}</span>
                <div className="split-track">
                  <div style={{ width: `${(s.minutes / subjectMax) * 100}%` }} />
                </div>
                <span className="split-val">{hm(s.minutes)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
