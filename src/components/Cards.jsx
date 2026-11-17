// Flashcards tab.
//   • Review: the cards due today, one at a time. Tap the card (or press
//     Space) to flip it, then say if you got it (keys 1 = missed, 2 = got it).
//   • Make cards: let the AI write them from a chapter, or type your own.
//   • Decks: your cards grouped by subject, with when each comes back.
import { useEffect, useMemo, useState } from "react";
import { api } from "../utils/api.js";
import { BOX_DAYS, CARD_XP, dueCards } from "../utils/game.js";
import { formatDay, parseISODate } from "../utils/dates.js";

export default function Cards({ subjects, progress, aiOn, onAdd, onReview, onDelete }) {
  const due = useMemo(() => dueCards(progress), [progress]);
  const [session, setSession] = useState(null); // { ids: [...], index, flipped, right, wrong }

  return (
    <div className="cards-tab">
      {session ? (
        <Review session={session} setSession={setSession} cards={progress.cards} subjects={subjects} onReview={onReview} />
      ) : (
        <>
          <div className="due-card">
            <div>
              <p className="due-num">{due.length}</p>
              <p className="muted">card{due.length === 1 ? "" : "s"} to review today</p>
            </div>
            <button
              className="btn btn-primary btn-big"
              disabled={due.length === 0}
              onClick={() => setSession({ ids: shuffle(due.map((c) => c.id)), index: 0, flipped: false, right: 0, wrong: 0 })}
            >
              {due.length ? "Start review" : "All done for today"}
            </button>
          </div>
          <p className="muted panel-sub">
            Spaced repetition: a card you get right comes back later and later ({BOX_DAYS.join(", ")} days). One you miss
            comes back tomorrow. +{CARD_XP} XP per card reviewed.
          </p>
          <MakeCards subjects={subjects} progress={progress} aiOn={aiOn} onAdd={onAdd} />
          <Decks subjects={subjects} cards={progress.cards} onDelete={onDelete} />
        </>
      )}
    </div>
  );
}

function shuffle(a) {
  const x = [...a];
  for (let i = x.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [x[i], x[j]] = [x[j], x[i]];
  }
  return x;
}

function Review({ session, setSession, cards, subjects, onReview }) {
  const card = cards.find((c) => c.id === session.ids[session.index]);
  const finished = session.index >= session.ids.length;
  const subject = card && subjects.find((s) => s.id === card.subjectId);

  function answer(correct) {
    if (!card || !session.flipped) return;
    onReview(card.id, correct);
    setSession({ ...session, index: session.index + 1, flipped: false, right: session.right + (correct ? 1 : 0), wrong: session.wrong + (correct ? 0 : 1) });
  }

  // Keyboard: Space flips, 1 = missed, 2 = got it, Escape = stop
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.key === " ") {
        e.preventDefault();
        setSession((s) => ({ ...s, flipped: !s.flipped }));
      } else if (e.key === "1") answer(false);
      else if (e.key === "2") answer(true);
      else if (e.key === "Escape") setSession(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  if (finished || !card) {
    return (
      <div className="review-done">
        <p className="due-num">{session.right}/{session.right + session.wrong}</p>
        <p>
          {session.wrong === 0 ? "Perfect round." : `${session.wrong} card${session.wrong === 1 ? "" : "s"} will come back tomorrow.`} +
          {(session.right + session.wrong) * CARD_XP} XP
        </p>
        <button className="btn btn-primary" onClick={() => setSession(null)}>
          Back to cards
        </button>
      </div>
    );
  }

  return (
    <div className="review">
      <div className="review-top">
        <span className="muted">
          Card {session.index + 1} of {session.ids.length}
          {subject && <>, {subject.name}</>}
          {card.topic && <>: {card.topic}</>}
        </span>
        <button className="link-btn" onClick={() => setSession(null)}>
          Stop
        </button>
      </div>
      <button
        className={`flashcard ${session.flipped ? "is-flipped" : ""}`}
        style={{ "--ink": subject?.color ?? "var(--mana)" }}
        onClick={() => setSession({ ...session, flipped: !session.flipped })}
        aria-label={session.flipped ? "Answer side. Tap to see the question" : "Question side. Tap to see the answer"}
      >
        <span className="flashcard-side">{session.flipped ? "Answer" : "Question"}</span>
        <span className="flashcard-text">{session.flipped ? card.back : card.front}</span>
        {!session.flipped && <span className="flashcard-hint">Tap or press Space to flip</span>}
      </button>
      <div className="review-actions">
        <button className="btn btn-hit btn-big" onClick={() => answer(false)} disabled={!session.flipped}>
          Missed it <kbd>1</kbd>
        </button>
        <button className="btn btn-primary btn-big" onClick={() => answer(true)} disabled={!session.flipped}>
          Got it <kbd>2</kbd>
        </button>
      </div>
    </div>
  );
}

function MakeCards({ subjects, progress, aiOn, onAdd }) {
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? "");
  const subject = subjects.find((s) => s.id === subjectId);
  // Suggest the chapter you finished most recently (best time to make cards)
  const lastDone = [...(progress.chapterLog ?? [])].reverse().find((e) => e.subjectId === subjectId)?.name;
  const [topic, setTopic] = useState("");
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  async function makeWithAI() {
    const t = topic.trim() || lastDone || subject?.topics?.find((x) => !x.done)?.name || "";
    if (!t) return setError("Type the chapter or topic to make cards for.");
    setLoading(true);
    setError("");
    setMsg("");
    try {
      const { cards } = await api("/api/ai/flashcards", { method: "POST", json: { subject: subject?.name, topic: t, count: 8 } });
      onAdd(cards.map((c) => ({ ...c, subjectId, topic: t })));
      setMsg(`Added ${cards.length} cards on ${t}. They're ready to review now.`);
      setTopic("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function addOwn(e) {
    e.preventDefault();
    if (!front.trim() || !back.trim()) return setError("Fill in both the question and the answer.");
    onAdd([{ subjectId, topic: topic.trim(), front, back }]);
    setFront("");
    setBack("");
    setError("");
    setMsg("Card added.");
  }

  return (
    <div className="ai-card make-cards">
      <div className="ai-card-head">
        <h3>Make cards</h3>
        <select className="input select-small" value={subjectId} onChange={(e) => setSubjectId(e.target.value)} aria-label="Subject">
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <label className="field">
        <span>Chapter or topic</span>
        <input
          className="input"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder={lastDone ? `Default: ${lastDone} (your last finished chapter)` : "e.g. Normalization, DFA minimisation"}
          maxLength={120}
        />
      </label>
      {aiOn && (
        <button className="btn btn-primary make-ai" onClick={makeWithAI} disabled={loading}>
          {loading ? "Writing cards…" : "Make 8 cards with AI"}
        </button>
      )}
      <form className="own-card" onSubmit={addOwn}>
        <p className="muted">{aiOn ? "Or write your own:" : "Write your own cards (the AI can make them too once it's on):"}</p>
        <input className="input" value={front} onChange={(e) => setFront(e.target.value)} placeholder="Question, e.g. What is a candidate key?" maxLength={200} />
        <textarea className="input textarea small" rows={2} value={back} onChange={(e) => setBack(e.target.value)} placeholder="Answer" maxLength={400} />
        <button className="btn btn-ghost">Add card</button>
      </form>
      {error && <p className="error">{error}</p>}
      {msg && !error && <p className="ok-note">{msg}</p>}
    </div>
  );
}

function Decks({ subjects, cards, onDelete }) {
  const [open, setOpen] = useState(null);
  if (cards.length === 0) return <p className="muted">No cards yet. Make some above.</p>;
  return (
    <div className="decks">
      <h3 className="chart-title">Your decks</h3>
      {subjects
        .map((s) => ({ s, list: cards.filter((c) => c.subjectId === s.id) }))
        .filter((x) => x.list.length)
        .map(({ s, list }) => {
          const mastered = list.filter((c) => c.box >= 4).length;
          return (
            <div key={s.id} className="deck" style={{ "--ink": s.color }}>
              <button className="deck-head" onClick={() => setOpen(open === s.id ? null : s.id)} aria-expanded={open === s.id}>
                <b>{s.name}</b>
                <span className="muted">
                  {list.length} cards, {mastered} mastered
                </span>
              </button>
              {open === s.id && (
                <ul className="deck-list">
                  {list.map((c) => (
                    <li key={c.id}>
                      <span className="deck-front">{c.front}</span>
                      <span className="deck-due">box {c.box}, next {formatDay(parseISODate(c.due))}</span>
                      <button className="link-btn" onClick={() => onDelete(c.id)} aria-label="Delete card">
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
    </div>
  );
}
