// App = the "boss" component.
// It decides WHO is using the app and WHERE their plan is saved:
//   "cloud" mode: signed in with Google, plan saved in the server's database
//   "local" mode: no account, plan saved only in this browser (localStorage)
// Then it shows the sign-in screen, the setup flow, or the dashboard.
import { useCallback, useEffect, useRef, useState } from "react";
import Login from "./components/Login.jsx";
import Onboarding from "./components/Onboarding.jsx";
import Dashboard from "./components/Dashboard.jsx";
import Backdrop from "./components/Backdrop.jsx";
import { migrateColors } from "./utils/colors.js";
import { normalizePrefs } from "./utils/scheduler.js";
import { api } from "./utils/api.js";
import {
  CARD_XP,
  CHAPTER_XP,
  completeQuest,
  completeRevision,
  levelInfo,
  logChapter,
  logXpChange,
  newCard,
  normalizeProgress,
  recordQuiz,
  rememberPlan,
  reviewCard,
  skipQuest,
  toggleQuest,
  unlogChapter,
} from "./utils/game.js";
import { toISODate } from "./utils/dates.js";
import { applyLook, savedLook, watchSystemTheme } from "./utils/look.js";
import { bumpChapters, cleanSubjects, syncCounts, toggleTopic } from "./utils/subjects.js";
import { setSetting } from "./utils/alerts.js";
import { TIMER_KEY } from "./components/FocusTimer.jsx";

const LOCAL_KEY = "cramwise-data-v1";
const MODE_KEY = "cramwise-mode";

// Makes old or imported plans fit the current format
function tidy(data) {
  if (!data) return null;
  const migrated = migrateColors(data);
  return {
    ...migrated,
    subjects: cleanSubjects(migrated.subjects),
    prefs: normalizePrefs(migrated.prefs),
    progress: normalizeProgress(migrated.progress),
  };
}

function readLocal(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? tidy(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
function writeLocal(key, value) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
  } catch {
    /* storage blocked: the app still works for this visit */
  }
}

export default function App() {
  const [mode, setMode] = useState("loading"); // loading | login | local | cloud
  const [config, setConfig] = useState(null);
  const [serverDown, setServerDown] = useState(false);
  const [user, setUser] = useState(null);
  const [data, setDataRaw] = useState(null); // { userName, subjects, prefs } or null
  // Every change goes through here so XP gains are logged per day (for "XP this week")
  const setData = useCallback((next) => setDataRaw((d) => logXpChange(d, typeof next === "function" ? next(d) : next)), []);
  const [editing, setEditing] = useState(false);
  const [sync, setSync] = useState("idle"); // idle | saving | saved | error
  const [notice, setNotice] = useState("");
  const skipNextSave = useRef(false); // true = don't re-upload a plan we just downloaded
  const [levelUp, setLevelUp] = useState(null); // shows the big LEVEL UP moment

  // ── Appearance: from the plan if there is one, otherwise from this device ──
  const look = data?.prefs?.look ?? savedLook();
  const lookRef = useRef(look);
  lookRef.current = look;
  useEffect(() => applyLook(look), [look.theme, look.accent]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => watchSystemTheme(() => lookRef.current), []);
  function handleSetLook(next) {
    applyLook(next);
    if (data) setData((d) => ({ ...d, prefs: { ...d.prefs, look: next } }));
  }
  const lastLevel = useRef(null);

  // Signed in: fetch the plan from the server (or move this browser's plan up)
  const enterCloud = useCallback(async (u) => {
    setUser(u);
    lastLevel.current = null; // a different plan is loading: don't show "level up"
    try {
      const { plan } = await api("/api/plan");
      if (plan) {
        skipNextSave.current = true; // it came FROM the server, no need to send it back
        setData(tidy(plan));
      } else {
        const found = readLocal(LOCAL_KEY);
        // Only move a no-account plan into this account if the person says so
        // (it might belong to someone else who used this browser)
        const localPlan =
          found?.subjects?.length &&
          window.confirm(`This browser has a plan saved without an account (${found.userName || "no name"}). Move it into this account?`)
            ? found
            : null;
        if (localPlan) {
          await api("/api/plan", { method: "PUT", json: { plan: localPlan } });
          setNotice("Your plan from this browser is now saved to your account.");
          skipNextSave.current = true;
        }
        setData(localPlan);
      }
      setMode("cloud");
    } catch (e) {
      setNotice(e.message);
      setMode("login");
    }
  }, []);

  // On first load: is the server up? is someone already signed in?
  useEffect(() => {
    (async () => {
      try {
        const cfg = await api("/api/config");
        setConfig(cfg);
        const { user: u } = await api("/api/me");
        if (u) return enterCloud(u);
      } catch {
        setServerDown(true);
      }
      if (localStorage.getItem(MODE_KEY) === "local") {
        setData(readLocal(LOCAL_KEY));
        setMode("local");
      } else {
        setMode("login");
      }
    })();
  }, [enterCloud]);

  // ── Saving ──
  // Changes are saved 800ms after the last edit (so tapping + five times is one save).
  // `pendingSave` holds a plan that still needs sending, so we can send it
  // straight away when you sign out or close the tab, instead of losing it.
  const pendingSave = useRef(null);
  const saveTimer = useRef(null);

  const flushSave = useCallback(async () => {
    clearTimeout(saveTimer.current);
    const plan = pendingSave.current;
    if (!plan) return;
    pendingSave.current = null;
    try {
      await api("/api/plan", { method: "PUT", json: { plan } });
      if (!pendingSave.current) setSync("saved");
    } catch (e) {
      setSync("error");
      if (e.status === 401) {
        setNotice("You were signed out. Sign in again to keep saving.");
        setMode("login");
      }
    }
  }, []);

  useEffect(() => {
    if (mode === "local") {
      writeLocal(LOCAL_KEY, data);
      return;
    }
    if (mode !== "cloud" || !data) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    pendingSave.current = data;
    setSync("saving");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushSave, 800);
  }, [data, mode, flushSave]);

  // Closing or reloading the tab with an unsaved change: send it anyway
  // ("keepalive" lets the request finish after the page is gone)
  useEffect(() => {
    const onHide = () => {
      if (!pendingSave.current) return;
      fetch("/api/plan", {
        method: "PUT",
        keepalive: true,
        credentials: "same-origin",
        headers: { "X-Cramwise": "1", "Content-Type": "application/json" },
        body: JSON.stringify({ plan: pendingSave.current }),
      }).catch(() => {});
      pendingSave.current = null;
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);

  // Watch the level: when it goes UP, show the level-up moment for a few seconds
  const level = data?.progress ? levelInfo(data.progress.xp).level : null;
  useEffect(() => {
    if (level === null) return;
    if (lastLevel.current !== null && level > lastLevel.current) {
      setLevelUp(level);
      const t = setTimeout(() => setLevelUp(null), 2800);
      lastLevel.current = level;
      return () => clearTimeout(t);
    }
    lastLevel.current = level;
  }, [level]);

  function useLocal() {
    writeLocal(MODE_KEY, "local");
    setData(readLocal(LOCAL_KEY));
    setMode("local");
  }

  async function signOut() {
    await flushSave(); // don't lose the last change
    setSetting(TIMER_KEY, null); // a running timer belongs to this account
    lastLevel.current = null;
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      /* already signed out */
    }
    window.google?.accounts?.id?.disableAutoSelect?.();
    setUser(null);
    setData(null);
    setEditing(false);
    setSync("idle");
    setMode("login");
  }

  function goToSignIn() {
    writeLocal(MODE_KEY, null);
    setMode("login");
  }

  function handleFinish(newData) {
    // You changed your setup (study hours, week, subjects...): rebuild today's
    // quest list from the new settings. Quests you already ticked stay ticked
    // if they're still at the same time.
    const progress = data?.progress ? { ...data.progress, today: null } : undefined;
    // Keep your theme/colour choice when the setup is edited
    const prefs = { ...newData.prefs, look: newData.prefs?.look ?? look };
    setData(tidy({ ...newData, prefs, progress }));
    setEditing(false);
  }

  // A quick change from the dashboard (day off, busy tomorrow, study hours...):
  // save it and rebuild today's quests, same as finishing setup does
  function handleUpdatePrefs(prefs) {
    setData((d) => ({ ...d, prefs: normalizePrefs({ ...prefs, look: prefs.look ?? d.prefs?.look }), progress: { ...d.progress, today: null } }));
  }

  function handleImportPlan(newData) {
    lastLevel.current = null;
    setData(tidy(newData));
    setEditing(false);
  }

  function handleReset() {
    if (window.confirm("Delete your plan and start over?")) {
      clearTimeout(saveTimer.current);
      pendingSave.current = null;
      setSetting(TIMER_KEY, null);
      lastLevel.current = null;
      setData(null);
      setEditing(false);
      if (mode === "cloud") {
        // Save an empty plan so it's gone on other devices too
        api("/api/plan", {
          method: "PUT",
          json: { plan: { userName: "", subjects: [], prefs: normalizePrefs({ restDays: [] }) } },
        }).catch(() => setSync("error"));
      }
    }
  }

  // +1 / -1 chapter done -> urgency + timetable update, and +/- 30 XP
  function handleChapterChange(id, delta) {
    setData((d) => {
      let changed = 0;
      let chapter = null;
      const subjects = d.subjects.map((s) => {
        if (s.id !== id) return s;
        const [next, diff] = bumpChapters(s, delta);
        changed = diff;
        // Which chapter was it? (for revision rounds)
        if (diff > 0) {
          const ticked = next.topics?.find((t, i) => t.done && !s.topics[i].done);
          chapter = { subjectId: s.id, name: ticked?.name ?? `Chapter ${next.chaptersDone}` };
        } else if (diff < 0) {
          const unticked = s.topics?.find((t, i) => t.done && !next.topics[i].done);
          chapter = { subjectId: s.id, name: unticked?.name ?? `Chapter ${s.chaptersDone}` };
        }
        return next;
      });
      let progress = { ...d.progress, xp: Math.max(0, d.progress.xp + changed * CHAPTER_XP) };
      if (changed > 0) progress = logChapter(progress, chapter.subjectId, chapter.name, toISODate(new Date()));
      if (changed < 0) progress = unlogChapter(progress, chapter.subjectId, chapter.name);
      return { ...d, subjects, progress };
    });
  }

  // Tick / untick one named chapter
  function handleToggleTopic(id, index) {
    setData((d) => {
      let changed = 0;
      let name = "";
      const subjects = d.subjects.map((s) => {
        if (s.id !== id) return s;
        const [next, diff] = toggleTopic(s, index);
        changed = diff;
        name = s.topics[index].name;
        return next;
      });
      let progress = { ...d.progress, xp: Math.max(0, d.progress.xp + changed * CHAPTER_XP) };
      progress = changed > 0 ? logChapter(progress, id, name, toISODate(new Date())) : unlogChapter(progress, id, name);
      return { ...d, subjects, progress };
    });
  }

  // ── Revision rounds ──
  function handleRevisionDone(item) {
    setData((d) => ({ ...d, progress: completeRevision(d.progress, item) }));
  }

  // ── Flashcards ──
  function handleAddCards(list) {
    setData((d) => ({ ...d, progress: { ...d.progress, cards: [...d.progress.cards, ...list.map((c) => newCard(c))] } }));
  }
  function handleReviewCard(id, correct) {
    setData((d) => ({
      ...d,
      progress: {
        ...d.progress,
        xp: d.progress.xp + CARD_XP,
        cards: d.progress.cards.map((c) => (c.id === id ? reviewCard(c, correct) : c)),
      },
    }));
  }
  function handleDeleteCard(id) {
    setData((d) => ({ ...d, progress: { ...d.progress, cards: d.progress.cards.filter((c) => c.id !== id) } }));
  }

  // ── Quiz answers per chapter (for "weak chapters") ──
  function handleQuizAnswer(subjectId, topic, correct) {
    setData((d) => ({ ...d, progress: recordQuiz(d.progress, subjectId, topic, correct) }));
  }

  // Add a new boss, or save changes to one (from the Bosses tab)
  function handleSaveSubject(subject) {
    setData((d) => {
      const clean = syncCounts(subject);
      const exists = d.subjects.some((s) => s.id === clean.id);
      return { ...d, subjects: exists ? d.subjects.map((s) => (s.id === clean.id ? clean : s)) : [...d.subjects, clean] };
    });
  }

  function handleDeleteSubject(id) {
    // Rebuild today's quests too, so the deleted subject's free slots get used
    setData((d) => ({ ...d, subjects: d.subjects.filter((s) => s.id !== id), progress: { ...d.progress, today: null } }));
  }

  // The focus timer finished: mark that quest done (never un-marks it)
  function handleCompleteQuest(date, session) {
    setData((d) => {
      const subject = d.subjects.find((s) => s.id === session.subjectId);
      return { ...d, progress: completeQuest(d.progress, date, session, subject) };
    });
  }

  function handleSkipMissed(key) {
    setData((d) => ({ ...d, progress: skipQuest(d.progress, key) }));
  }

  // XP from answering AI quiz questions correctly
  function handleQuizXp(amount) {
    setData((d) => ({
      ...d,
      progress: { ...d.progress, xp: d.progress.xp + amount, quizXp: (d.progress.quizXp ?? 0) + amount },
    }));
  }

  // Tick / untick a study session (quest)
  function handleToggleQuest(date, session) {
    setData((d) => {
      const subject = d.subjects.find((s) => s.id === session.subjectId);
      return { ...d, progress: toggleQuest(d.progress, date, session, subject) };
    });
  }

  // Freeze today's quest list (so ticking chapters doesn't reshuffle today),
  // and remember it in the history for "missed quests" and stats
  function handleSnapshot(today) {
    setData((d) => ({ ...d, progress: rememberPlan(d.progress, today.date, today.sessions) }));
  }

  const aiOn = mode === "cloud" && Boolean(config?.aiEnabled);
  // Why AI is on/off, so the app can say so clearly
  const aiState = aiOn ? "on" : mode !== "cloud" ? (serverDown ? "noserver" : "signin") : "nokey";
  const hasPlan = data && data.subjects?.length > 0;
  const syncText = { saving: "Saving…", saved: "Saved", error: "Couldn't save. Will retry on your next change." }[sync];

  return (
    <main className="app">
      <Backdrop />
      <header className="topbar">
        <span className="wordmark">
          Cram<span>wise</span>
        </span>
        <div className="topbar-right">
          {editing && (
            <button className="link-btn" onClick={() => setEditing(false)}>
              Cancel editing
            </button>
          )}
          {mode === "cloud" && (
            <>
              {syncText && <span className={`sync sync-${sync}`}>{syncText}</span>}
              <span className="who">
                {user?.picture && <img src={user.picture} alt="" referrerPolicy="no-referrer" />}
                {user?.name || user?.email}
              </span>
            </>
          )}
          {mode === "local" && (
            <>
              <span className="sync">Saved on this device only</span>
              {!serverDown && (
                <button className="link-btn" onClick={goToSignIn}>
                  Sign in
                </button>
              )}
            </>
          )}
        </div>
      </header>

      {notice && (
        <p className="banner" role="status">
          {notice}{" "}
          <button className="link-btn" onClick={() => setNotice("")}>
            Dismiss
          </button>
        </p>
      )}

      {mode === "loading" && <p className="lead">Loading…</p>}

      {mode === "login" && (
        <Login config={config} serverDown={serverDown} onSignedIn={enterCloud} onUseLocal={useLocal} />
      )}

      {(mode === "local" || mode === "cloud") &&
        (!hasPlan || editing ? (
          <Onboarding
            initial={data ? data : user ? { userName: user.name?.split(" ")[0] ?? "" } : null}
            onFinish={handleFinish}
            onImportPlan={handleImportPlan}
            aiState={aiState}
          />
        ) : (
          <Dashboard
            data={data}
            onEdit={() => setEditing(true)}
            onReset={handleReset}
            onChapterChange={handleChapterChange}
            onImportPlan={handleImportPlan}
            onToggleQuest={handleToggleQuest}
            onCompleteQuest={handleCompleteQuest}
            onToggleTopic={handleToggleTopic}
            onSaveSubject={handleSaveSubject}
            onDeleteSubject={handleDeleteSubject}
            onSkipMissed={handleSkipMissed}
            onQuizXp={handleQuizXp}
            onQuizAnswer={handleQuizAnswer}
            onRevisionDone={handleRevisionDone}
            onAddCards={handleAddCards}
            onReviewCard={handleReviewCard}
            onDeleteCard={handleDeleteCard}
            look={look}
            onSetLook={handleSetLook}
            onSnapshot={handleSnapshot}
            onUpdatePrefs={handleUpdatePrefs}
            onSignOut={mode === "cloud" ? signOut : null}
            aiOn={aiOn}
            aiState={aiState}
          />
        ))}

      {levelUp && (
        <div className="levelup" role="status" aria-live="assertive">
          <div className="levelup-card">
            <span className="levelup-small">Level up</span>
            <span className="levelup-num">{levelUp}</span>
            <span className="levelup-sub">Keep going, {data?.userName || "player"}.</span>
          </div>
        </div>
      )}
    </main>
  );
}
