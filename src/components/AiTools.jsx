// The two AI tools on the dashboard:
//   PlanAdvice: AI looks at your plan and gives a few tips
//   StudyHelper: ask a doubt about a subject, like a chat
// Both talk to OUR server (/api/ai/...), which talks to the AI with the secret key.
import { useEffect, useRef, useState } from "react";
import { api } from "../utils/api.js";
import { urgencyBreakdown } from "../utils/urgency.js";
import { toISODate } from "../utils/dates.js";

export function PlanAdvice({ subjects, timetable }) {
  const [tips, setTips] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function getAdvice() {
    setLoading(true);
    setError("");
    // Only send what the AI needs: no names or emails
    const week = timetable.days.slice(0, 7);
    const summary = {
      today: toISODate(new Date()),
      subjects: subjects.map((s) => {
        const u = urgencyBreakdown(s);
        return {
          name: s.name,
          examDate: s.examDate,
          daysLeft: u.daysLeft,
          chaptersDone: s.chaptersDone,
          totalChapters: s.totalChapters,
          difficulty: s.difficulty,
          urgency: u.score,
          sessionsNext7Days: week.reduce((n, d) => n + d.sessions.filter((x) => x.subjectId === s.id).length, 0),
        };
      }),
      daysWithNoStudyTime: week.filter((d) => d.noTime).length,
    };
    try {
      const res = await api("/api/ai/advice", { method: "POST", json: { summary } });
      setTips(res.tips);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="ai-card">
      <div className="ai-card-head">
        <h3>Advice on your plan</h3>
        <button className="btn btn-ghost" onClick={getAdvice} disabled={loading}>
          {loading ? "Thinking…" : tips ? "Ask again" : "Get advice"}
        </button>
      </div>
      {!tips && !error && !loading && (
        <p className="hint">The AI checks your exams, chapters and timetable, and tells you what to fix.</p>
      )}
      {error && <p className="error">{error}</p>}
      {tips && (
        <ul className="tips">
          {tips.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function StudyHelper({ subjects }) {
  const [subject, setSubject] = useState(subjects[0]?.name ?? "");
  const [messages, setMessages] = useState([]); // { role: "user" | "assistant", text }
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages, loading]);

  async function send(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    const next = [...messages, { role: "user", text }];
    setMessages(next);
    setInput("");
    setLoading(true);
    setError("");
    try {
      const { answer } = await api("/api/ai/chat", { method: "POST", json: { subject, messages: next } });
      setMessages([...next, { role: "assistant", text: answer }]);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="ai-card helper">
      <div className="ai-card-head">
        <h3>Study helper</h3>
        <label className="helper-subject">
          <span>About</span>
          <select className="input" value={subject} onChange={(e) => setSubject(e.target.value)}>
            {subjects.map((s) => (
              <option key={s.id}>{s.name}</option>
            ))}
            <option value="">Anything</option>
          </select>
        </label>
      </div>

      <div className="chat" aria-live="polite">
        {messages.length === 0 && (
          <p className="hint">Ask a doubt, like "Explain the Floyd-Warshall recurrence with a small example".</p>
        )}
        {messages.map((m, i) => (
          // Shown as plain text (never as HTML), so nothing in an answer can run code on the page
          <div key={i} className={`msg msg-${m.role}`}>
            {m.text}
          </div>
        ))}
        {loading && <div className="msg msg-assistant msg-wait">Thinking…</div>}
        <div ref={endRef} />
      </div>

      {error && <p className="error">{error}</p>}
      <form className="chat-form" onSubmit={send}>
        <input
          className="input"
          placeholder="Type your doubt"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={2000}
        />
        <button className="btn btn-primary" disabled={loading || !input.trim()}>
          Ask
        </button>
      </form>
      {messages.length > 0 && (
        <button className="link-btn" onClick={() => setMessages([])}>
          Clear chat
        </button>
      )}
    </div>
  );
}

// "Quiz me": the AI writes multiple-choice questions on a subject/topic.
// Each correct answer = +10 XP (one try per question).
export const QUIZ_XP = 10;

export function QuizMe({ subjects, onXp, onAnswer, preset }) {
  const [subjectId, setSubjectId] = useState(preset?.subjectId ?? subjects[0]?.id ?? "");
  const [topic, setTopic] = useState(preset?.topic ?? "");
  const [askedTopic, setAskedTopic] = useState(""); // the topic this quiz is about (for scores)
  const [questions, setQuestions] = useState(null);
  const [picked, setPicked] = useState({}); // question index -> chosen option
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const subject = subjects.find((s) => s.id === subjectId);
  // Suggest the next unfinished chapter as the topic
  const suggestion = subject?.topics?.find((t) => !t.done)?.name ?? "";

  async function makeQuiz() {
    setLoading(true);
    setError("");
    setQuestions(null);
    setPicked({});
    try {
      const t = topic.trim() || suggestion;
      setAskedTopic(t);
      const res = await api("/api/ai/quiz", {
        method: "POST",
        json: { subject: subject?.name ?? "", topic: t, count: 5 },
      });
      setQuestions(res.questions);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function choose(qi, oi) {
    if (picked[qi] !== undefined) return; // one try only
    setPicked({ ...picked, [qi]: oi });
    const right = questions[qi].answer === oi;
    if (right) onXp(QUIZ_XP);
    // Remember how you did on this chapter (used for "weak chapters" in exam week)
    onAnswer?.(subjectId, askedTopic, right);
  }

  const answered = Object.keys(picked).length;
  const correct = questions ? questions.filter((q, i) => picked[i] === q.answer).length : 0;

  return (
    <div className="ai-card quiz">
      <div className="ai-card-head">
        <h3>Quiz me</h3>
        <span className="hint">+{QUIZ_XP} XP per right answer</span>
      </div>
      <div className="quiz-form">
        <select className="input" value={subjectId} onChange={(e) => setSubjectId(e.target.value)} aria-label="Subject">
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <input
          className="input"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder={suggestion ? `Topic (default: ${suggestion})` : "Topic, e.g. Normalization, DFA minimisation"}
          maxLength={120}
          onKeyDown={(e) => e.key === "Enter" && makeQuiz()}
        />
        <button className="btn btn-primary" onClick={makeQuiz} disabled={loading}>
          {loading ? "Writing questions…" : questions ? "New quiz" : "Start quiz"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}

      {questions && (
        <>
          <ol className="quiz-list">
            {questions.map((q, qi) => (
              <li key={qi} className="quiz-q">
                <p className="quiz-question">{q.question}</p>
                <div className="quiz-options">
                  {q.options.map((o, oi) => {
                    const chosen = picked[qi];
                    const state =
                      chosen === undefined ? "" : oi === q.answer ? "is-right" : oi === chosen ? "is-wrong" : "is-dim";
                    return (
                      <button key={oi} className={`quiz-opt ${state}`} onClick={() => choose(qi, oi)} disabled={chosen !== undefined}>
                        {o}
                      </button>
                    );
                  })}
                </div>
                {picked[qi] !== undefined && q.explanation && <p className="quiz-explain">{q.explanation}</p>}
              </li>
            ))}
          </ol>
          {answered === questions.length && (
            <p className="quiz-score">
              Score: {correct}/{questions.length}, +{correct * QUIZ_XP} XP
              {correct === questions.length ? ". Perfect run!" : correct >= questions.length / 2 ? ". Solid." : ". Revise this one again."}
            </p>
          )}
        </>
      )}
    </div>
  );
}
