# Cramwise

A smart study planner for anyone, anywhere: tell it your subjects, exam dates (or no deadline at all) and how much is left,
and it builds a day-by-day timetable that focuses on whatever is most urgent.

## Run it

On Windows: double-click `START-CRAMWISE.bat`. It installs what's missing, starts the
Flask server (accounts, database, AI) in its own window, and opens the app.

By hand:

```bash
cd server && python -m venv .venv && .venv/Scripts/pip install -r requirements.txt && .venv/Scripts/python app.py
npm install && npm run dev      # in another terminal, then open http://localhost:5173
```

To switch on Google sign-in and AI, see **SETUP-ONLINE.md**.

## What it does

- **Quests**: today's study sessions, tick them off (or run the focus timer) for XP
- **Bosses**: each exam is a boss, HP = chapters left; add chapter names to get "next chapter" hints
- **Import**: upload your exam timetable and/or syllabus; the AI fills in subjects, exam dates and times, and chapters, and you check them in one table first
- **No deadline?** Things you're just learning (a language, coding...) get steady study time every week, with no countdown
- **Works worldwide**: dates and times follow your own country's style (5 Dec vs Dec 5, 24-hour vs AM/PM)
- **Week**: day view of your timetable around classes, work and meal times (works past midnight)
- **Cards**: flashcards with spaced repetition (right = comes back in 1, 2, 4, 7, 14 days; wrong = tomorrow). The AI can write them from a chapter
- **Revision rounds**: every chapter you finish comes back as a 15-minute revision 1, 3 and 7 days later
- **Exam week**: 3 days before an exam that subject becomes revision-only, with your weak chapters (from quiz scores) and a one-tap quick quiz
- **Progress**: hours this week, a 7-day chart, time per subject, friends leaderboard (weekly XP, shared streaks), trophies
- **AI coach** (needs a Gemini key): quizzes, a study helper chat, plan advice, reading timetable photos and syllabi
- **Phone app**: install it to your home screen (works offline once loaded, reminders as phone notifications)
- Menu: appearance (dark / light / auto + 4 accent colours), reminders, PDF, Google Calendar (.ics), backups, edit setup

## How the code is organised

```
src/
  main.jsx                 entry point, loads fonts
  App.jsx                  who's signed in, where the plan is saved, all the "change the plan" handlers
  index.css                all styling (colours at the top in :root)
  components/
    Login.jsx              sign-in screen (Google, test login, or no account)
    Onboarding.jsx         3-step setup: you, bosses, your week
    WeekEditor.jsx         fixed week (classes, labs, meals) + AI timetable reading
    Dashboard.jsx          main screen: tabs, menu, timer, reminders
    Hud.jsx                player bar (level, XP, streak) + menu
    Quests.jsx             today's quests + missed quests
    FocusTimer.jsx         countdown docked at the bottom
    Bosses.jsx             boss cards (HP bars, chapters, threat level)
    BossEditor.jsx         add / edit / delete a boss
    ExamBoard.jsx          LED boss board   (uses SplitFlap.jsx for the flipping letters)
    Timetable.jsx          week day view
    Stats.jsx              progress numbers and charts
    Trophies.jsx           achievements
    AiTools.jsx            quiz, study helper, plan advice
    Cards.jsx              flashcards: review, make (AI or by hand), decks
    StudyExtras.jsx        exam-week panel + revision rounds
    Friends.jsx            friend code + weekly leaderboard
    Appearance.jsx         theme and accent colour picker
    StudyImport.jsx        AI reads your exam timetable + syllabus into bosses
    DeadlineField.jsx      "Has a date / No deadline" picker with optional exam time
  utils/
    scheduler.js           timetable generator (step-by-step comments inside)
    urgency.js             urgency score (0-100)
    game.js                XP, levels, streaks, trophies, missed quests, stats,
                           flashcard boxes, revision rounds, weak chapters, XP per day
    look.js                dark / light / auto theme + accent colours
    subjects.js            chapters / topics helpers
    calendar.js            .ics export     alerts.js  sounds + notifications
    api.js  planFile.js  pdfExport.js  dates.js  colors.js
server/
  app.py                   Flask app: settings, security headers, CSRF check
  auth.py                  Google sign-in, sessions
  plans.py                 save/load each user's plan
  ai.py                    Gemini: timetable photos, chat, advice, quizzes, exam timetables, syllabus, flashcards (with retries)
  friends.py               friend codes + weekly leaderboard
  models.py  validate.py  test_app.py
public/
  manifest.webmanifest  sw.js  icons/   phone-app files (install + offline)
```

## The urgency formula

```
score = 100 × (0.45 × deadline + 0.25 × difficulty + 0.30 × load)

deadline   = 1 / (1 + daysLeft / 7)
difficulty = difficulty / 5
load       = min(1, (chaptersLeft / daysLeft) / 2)
```

## Scheduler rules

- Sessions per day = how many (session + break) blocks fit in your daily hours
- Sessions are shared out in proportion to each subject's urgency *for that day*
- Day before an exam → that subject gets at least half the day (revision)
- Rest days are skipped if an exam is the next day
- Every subject gets at least 1 session every 2 days
- No subject twice in a row; harder subjects go earlier in the day

Signed in, your plan and XP are saved in the server's database. Without an account they stay in this browser.

On Windows you can also just double-click `START-CRAMWISE.bat`.
