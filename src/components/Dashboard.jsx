// Main screen after setup. Player bar on top, then tabs:
//   Today    today's quests + the most dangerous boss
//   Bosses   all exams, chapter progress, boss board
//   Week     the full timetable
//   Progress weekly stats + trophies
//   Coach    AI help: advice, study helper, quizzes (when AI is on)
// Plus the focus timer docked at the bottom while a quest is running.
import { useEffect, useMemo, useRef, useState } from "react";
import Hud from "./Hud.jsx";
import Quests from "./Quests.jsx";
import Bosses from "./Bosses.jsx";
import ExamBoard from "./ExamBoard.jsx";
import Timetable from "./Timetable.jsx";
import Trophies from "./Trophies.jsx";
import Stats from "./Stats.jsx";
import BossEditor from "./BossEditor.jsx";
import QuickAdjust from "./QuickAdjust.jsx";
import StudyImport from "./StudyImport.jsx";
import Cards from "./Cards.jsx";
import Friends from "./Friends.jsx";
import Appearance from "./Appearance.jsx";
import { InstallBanner } from "./InstallButton.jsx";
import { ExamWeek, Revisions } from "./StudyExtras.jsx";
import FocusTimer, { TIMER_KEY } from "./FocusTimer.jsx";
import { PlanAdvice, StudyHelper, QuizMe } from "./AiTools.jsx";
import { dueCards, examWeekSubjects, missedQuests, revisionsDue } from "../utils/game.js";
import { nextTopic } from "../utils/subjects.js";
import { downloadIcs } from "../utils/calendar.js";
import { askNotificationPermission, getSetting, notify, notificationsSupported, setSetting } from "../utils/alerts.js";
import { generateTimetable } from "../utils/scheduler.js";
import { exportTimetablePDF } from "../utils/pdfExport.js";
import { downloadPlan, readPlanFile } from "../utils/planFile.js";
import { toISODate, timeToMinutes, addDays, formatTime } from "../utils/dates.js";

const TABS = [
  { id: "today", label: "Today" },
  { id: "bosses", label: "Bosses" },
  { id: "cards", label: "Cards" },
  { id: "week", label: "Week" },
  { id: "progress", label: "Progress" },
  { id: "coach", label: "AI coach" },
];

export default function Dashboard(props) {
  const { data, onEdit, onReset, onChapterChange, onImportPlan, onToggleQuest, onSnapshot, onSignOut, aiOn, aiState } = props;
  const { onCompleteQuest, onToggleTopic, onSaveSubject, onDeleteSubject, onSkipMissed, onQuizXp, onUpdatePrefs } = props;
  const { onQuizAnswer, onRevisionDone, onAddCards, onReviewCard, onDeleteCard, look, onSetLook } = props;
  const [lookOpen, setLookOpen] = useState(false);
  const [quizPreset, setQuizPreset] = useState(null); // { subjectId, topic, n } from "Quick quiz"
  const { userName, subjects, prefs, progress } = data;
  const [tab, setTab] = useState(() => getSetting("cramwise-tab", "today"));
  const [changeToday, setChangeToday] = useState(false);
  const [editing, setEditing] = useState(null); // null | "new" | subject being edited
  const [syllabusOpen, setSyllabusOpen] = useState(false);
  // A saved timer is only used if its subject still exists in THIS plan
  const [timer, setTimer] = useState(() => {
    const t = getSetting(TIMER_KEY, null);
    return t && subjects.some((x) => x.id === t.session?.subjectId) ? t : null;
  });
  // Re-render every minute so "Now" tags and after-midnight quests stay correct
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60000);
    return () => clearInterval(t);
  }, []);
  const [reminders, setReminders] = useState(() => getSetting("cramwise-reminders", false));

  useEffect(() => setSetting("cramwise-tab", tab), [tab]);
  const [fileMsg, setFileMsg] = useState("");
  const fileRef = useRef(null);

  // useMemo = only re-run the scheduler when subjects/prefs actually change
  const timetable = useMemo(() => generateTimetable(subjects, prefs), [subjects, prefs]);
  const todayISO = toISODate(new Date());
  const generatedToday = timetable.days.find((d) => d.date === todayISO);

  // Today's quests are "frozen" once you tick the first one (or start a timer),
  // so finishing a chapter (which changes urgency) doesn't reshuffle your day.
  const timerToday = timer?.phase === "focus" && timer.date === todayISO;
  const doneToday = (progress.done[todayISO] ?? []).length > 0 || timerToday;
  const snap = progress.today?.date === todayISO ? progress.today : null;
  useEffect(() => {
    if (!generatedToday) return;
    const fresh = { date: todayISO, sessions: generatedToday.sessions };
    const same = snap && JSON.stringify(snap.sessions) === JSON.stringify(fresh.sessions);
    if (!snap || (!doneToday && !same)) onSnapshot(fresh);
  }, [generatedToday, snap, doneToday, todayISO, onSnapshot]);
  // (quests for a subject you've since deleted are dropped)
  const todaySessions = (snap?.sessions ?? generatedToday?.sessions ?? []).filter((s) =>
    subjects.some((x) => x.id === s.subjectId)
  );

  // Late-night study: yesterday's sessions after midnight (e.g. 00:05) still
  // belong to "last night", so keep showing them until they've ended.
  const nowM = new Date().getHours() * 60 + new Date().getMinutes();
  const yesterdayISO = toISODate(addDays(new Date(), -1));
  const carryOver = (progress.planned?.[yesterdayISO] ?? [])
    .filter((s) => (s.startMin ?? 0) >= 1440 && (s.endMin ?? 0) - 1440 > nowM)
    .map((s) => ({ ...s, _date: yesterdayISO }));
  const questItems = [...carryOver, ...todaySessions.map((s) => ({ ...s, _date: todayISO }))];

  // The Week tab shows the frozen version of today too
  const shownTimetable = useMemo(
    () => ({
      ...timetable,
      days: timetable.days.map((d) => (d.date === todayISO ? { ...d, sessions: todaySessions } : d)),
    }),
    [timetable, todayISO, todaySessions]
  );

  // Missed quests from the last 3 days (planned but not done, not skipped)
  const missed = useMemo(() => missedQuests(progress), [progress]);
  const revisions = useMemo(() => revisionsDue(progress, subjects), [progress, subjects]);
  const examWeek = useMemo(() => examWeekSubjects(subjects), [subjects]);
  const cardsDue = useMemo(() => dueCards(progress).length, [progress]);

  // Start the focus timer for a quest (length = that session's length)
  function startQuest(item) {
    // Don't silently throw away a focus timer that's already running
    if (timer?.phase === "focus" && timer.session.start !== item.start) {
      if (!window.confirm(`A focus timer for ${timer.session.subjectName} is still running. Stop it and start ${item.subjectName}?`)) return;
    }
    const { _date, ...session } = item;
    let minutes = timeToMinutes(session.end) - timeToMinutes(session.start);
    if (minutes <= 0) minutes += 1440; // e.g. 23:50 to 00:35
    const ms = Math.max(1, minutes) * 60000;
    const subject = subjects.find((x) => x.id === session.subjectId);
    setTimer({ date: _date ?? todayISO, session, topic: subject ? nextTopic(subject) : null, phase: "focus", endsAt: Date.now() + ms, totalMs: ms, pausedLeft: null });
  }

  // Session reminders: while the app is open, pop up a notification
  // 5 minutes before each of today's quests starts.
  const reminded = useRef(new Set());
  useEffect(() => {
    if (!reminders) return;
    const check = () => {
      const d = new Date();
      const nowM = d.getHours() * 60 + d.getMinutes();
      questItems.forEach((s) => {
        // carried-over sessions are from yesterday, so their minutes are 1440 too high
        const startM = (s.startMin ?? timeToMinutes(s.start)) - (s._date !== todayISO ? 1440 : 0);
        const key = `${s._date}|${s.start}`;
        if (startM - nowM <= 5 && startM - nowM >= 0 && !reminded.current.has(key)) {
          reminded.current.add(key);
          notify(`${s.subjectName} in ${startM - nowM} min`, `Quest at ${formatTime(s.start)}. Open Cramwise and press Start.`);
        }
      });
    };
    check();
    const t = setInterval(check, 30000);
    return () => clearInterval(t);
  }, [reminders, questItems, todayISO]);

  async function toggleReminders() {
    if (reminders) {
      setReminders(false);
      setSetting("cramwise-reminders", false);
      setFileMsg("Session reminders are off.");
      return;
    }
    const ok = await askNotificationPermission();
    if (ok) {
      setReminders(true);
      setSetting("cramwise-reminders", true);
      setFileMsg("Session reminders are on. You'll get a pop-up 5 minutes before each quest while Cramwise is open.");
    } else {
      setFileMsg(
        notificationsSupported()
          ? "Your browser blocked notifications. Click the lock icon next to the address bar, allow Notifications, then try again."
          : "This browser doesn't support notifications."
      );
    }
  }

  async function onLoadFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const r = await readPlanFile(file);
      if (r.kind === "plan") {
        onImportPlan(r.data);
        setFileMsg(`Loaded the plan from ${file.name}.`);
      } else {
        onImportPlan({ ...data, prefs: { ...prefs, busy: [...prefs.busy, ...r.busy] } });
        setFileMsg(`Added ${r.busy.length} fixed blocks from ${file.name} to your week.`);
      }
    } catch (err) {
      setFileMsg(err.message);
    }
  }

  const menuItems = [
    { label: "Change my timetable", hint: "Day off, busy hours, study hours", onClick: () => setTab("week") },
    { label: "Edit full setup", hint: "Name, subjects, week, study hours", onClick: onEdit },
    { label: "Appearance", hint: "Dark, light, accent colour", onClick: () => setLookOpen(true) },
    { label: reminders ? "Turn off session reminders" : "Turn on session reminders", hint: "Pop-up 5 min before each quest", onClick: toggleReminders },
    { divider: true, key: "d0" },
    { label: "Download timetable PDF", onClick: () => exportTimetablePDF({ userName, subjects, timetable: shownTimetable }) },
    {
      label: "Add to Google Calendar (.ics)",
      hint: "Import it in Google Calendar settings",
      onClick: () => {
        downloadIcs(shownTimetable, subjects);
        setFileMsg("Downloaded cramwise-study-plan.ics. In Google Calendar: Settings, Import & export, Import, then pick that file.");
      },
    },
    { divider: true, key: "d1" },
    { label: "Save backup file", hint: ".json file of your whole plan", onClick: () => downloadPlan(data) },
    { label: "Load backup file", onClick: () => fileRef.current?.click() },
    { divider: true, key: "d2" },
    ...(onSignOut ? [{ label: "Sign out", onClick: onSignOut }] : []),
    { label: "Start over", hint: "Deletes your plan and XP", danger: true, onClick: onReset },
  ];

  return (
    <div className="dash">
      <Hud name={userName} progress={progress} menuItems={menuItems} />
      <InstallBanner />
      <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={onLoadFile} />
      {fileMsg && (
        <p className="banner" role="status">
          {fileMsg}{" "}
          <button className="link-btn" onClick={() => setFileMsg("")}>
            Dismiss
          </button>
        </p>
      )}

      <nav className="tabs" role="tablist" aria-label="Sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? "on" : ""}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === "cards" && cardsDue > 0 && <span className="tab-badge">{cardsDue}</span>}
          </button>
        ))}
      </nav>

      <div className="tab-panel" role="tabpanel" key={tab}>
        {tab === "today" && (
          <div className="today-grid">
            <section>
              <ExamWeek
                items={examWeek}
                progress={progress}
                dueCardCount={cardsDue}
                onQuiz={(subjectId, topic) => {
                  setQuizPreset({ subjectId, topic, n: Date.now() });
                  setTab("coach");
                }}
                onCards={() => setTab("cards")}
              />
              <div className="title-row">
                <h2 className="panel-title">Today's quests</h2>
                <button className="btn btn-ghost btn-small" aria-expanded={changeToday} onClick={() => setChangeToday(!changeToday)}>
                  {changeToday ? "Close" : "Plans changed?"}
                </button>
              </div>
              {changeToday && <QuickAdjust prefs={prefs} onChange={onUpdatePrefs} aiState={aiState} only="once" subjects={subjects} />}
              <Quests
                date={todayISO}
                sessions={questItems}
                busy={generatedToday?.busy ?? []}
                subjects={subjects}
                progress={progress}
                onToggle={onToggleQuest}
                isRest={generatedToday?.rest}
                onStart={startQuest}
                activeKey={timer?.phase === "focus" ? `${timer.date}|${timer.session.start}` : null}
                missed={missed}
                onMakeUp={onToggleQuest}
                onSkip={onSkipMissed}
              />
              <Revisions items={revisions} onDone={onRevisionDone} />
            </section>
            <aside>
              {cardsDue > 0 && (
                <button className="cards-nudge" onClick={() => setTab("cards")}>
                  <span className="cards-nudge-num">{cardsDue}</span>
                  <span>
                    flashcard{cardsDue === 1 ? "" : "s"} to review
                    <small>Takes a few minutes. Tap to start.</small>
                  </span>
                </button>
              )}
              <h2 className="panel-title">Biggest threat</h2>
              <Bosses subjects={subjects} onChapterChange={onChapterChange} onToggleTopic={onToggleTopic} compact />
              <button className="link-btn see-all" onClick={() => setTab("bosses")}>
                See all bosses
              </button>
            </aside>
          </div>
        )}

        {tab === "cards" && (
          <Cards subjects={subjects} progress={progress} aiOn={aiOn} onAdd={onAddCards} onReview={onReviewCard} onDelete={onDeleteCard} />
        )}

        {tab === "bosses" && (
          <>
            <ExamBoard subjects={subjects} />
            <div className="title-row spaced">
              <h2 className="panel-title">Your bosses</h2>
              <button className="btn btn-ghost btn-small" onClick={() => setSyllabusOpen(true)}>
                Import exams / syllabus
              </button>
            </div>
            <p className="muted panel-sub">
              Boss HP = chapters left. Hit "Chapter done" when you finish one. Tap the threat level to see how it's
              worked out.
            </p>
            <Bosses
              subjects={subjects}
              onChapterChange={onChapterChange}
              onToggleTopic={onToggleTopic}
              onEdit={(s) => setEditing(s)}
              onAdd={() => setEditing("new")}
            />
          </>
        )}

        {tab === "week" && (
          <>
            <h2 className="panel-title">Quick adjust</h2>
            <QuickAdjust prefs={prefs} onChange={onUpdatePrefs} aiState={aiState} subjects={subjects} />
            <h2 className="panel-title spaced">Your timetable</h2>
            <p className="muted panel-sub">
              Striped = classes and labs, dotted = meals, colour = study. The yellow line is the time right now. Up to{" "}
              {timetable.sessionsPerDay} sessions a day, fitted into your free gaps.
            </p>
            <Timetable timetable={shownTimetable} />
          </>
        )}

        {tab === "progress" && (
          <>
            <Stats progress={progress} subjects={subjects} />
            <Friends signedIn={Boolean(onSignOut)} xpVersion={progress.xp} />
            <h2 className="panel-title spaced">Trophies</h2>
            <Trophies progress={progress} subjects={subjects} />
          </>
        )}

        {tab === "coach" &&
          (aiOn ? (
            <div className="coach">
              <QuizMe key={quizPreset?.n ?? "quiz"} subjects={subjects} onXp={onQuizXp} onAnswer={onQuizAnswer} preset={quizPreset} />
              <div className="ai-grid">
                <PlanAdvice subjects={subjects} timetable={shownTimetable} />
                <StudyHelper subjects={subjects} />
              </div>
            </div>
          ) : (
            <AiOff state={aiState} />
          ))}
      </div>

      {editing && (
        <BossEditor
          subject={editing === "new" ? null : editing}
          count={subjects.length}
          existing={subjects}
          onSave={onSaveSubject}
          onDelete={onDeleteSubject}
          onClose={() => setEditing(null)}
        />
      )}

      {lookOpen && <Appearance look={look} onChange={onSetLook} onClose={() => setLookOpen(false)} />}

      {syllabusOpen && (
        <StudyImport
          existing={subjects}
          aiState={aiState}
          onApply={(list) => list.forEach((s) => onSaveSubject(s))}
          onClose={() => setSyllabusOpen(false)}
        />
      )}

      {timer && <FocusTimer timer={timer} setTimer={setTimer} breakMinutes={Number(prefs.breakLength) || 0} onComplete={onCompleteQuest} />}
    </div>
  );
}

// Explains in plain words why the AI is off and what to do about it
export function AiOff({ state }) {
  const text = {
    signin: "The AI coach needs an account. Click Sign in at the top right (Test login works on your laptop).",
    noserver: "The Cramwise server isn't running. Start the app with START-CRAMWISE.bat so both windows open.",
    nokey:
      "The AI is switched off because there's no Gemini API key yet. Get a free one at aistudio.google.com, paste it after GEMINI_API_KEY= in server/.env, then restart START-CRAMWISE.bat. SETUP-ONLINE.md has every step.",
  }[state];
  return (
    <div className="ai-off">
      <p className="ai-off-title">AI is off</p>
      <p>{text}</p>
    </div>
  );
}
