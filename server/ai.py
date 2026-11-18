"""
AI features, using Google's Gemini API (free tier).

    GET  /api/ai/status      is AI set up? how many requests left today?
    POST /api/ai/timetable   upload a timetable photo/PDF -> fixed-week blocks
    POST /api/ai/chat        ask a study doubt
    POST /api/ai/advice      tips about your current plan
    POST /api/ai/quiz        a quiz: multiple choice, written or mixed; theory and/or problems
    POST /api/ai/check       mark a written answer against the model answer
    POST /api/ai/exams       read an exam timetable (date sheet) into exams with dates
    POST /api/ai/syllabus    read a syllabus into subjects, units and topics
    POST /api/ai/flashcards  make flashcards for a chapter

Why does this run on the SERVER and not in the browser?
Because the API key is a secret. Anything in the browser can be seen by
anyone who opens DevTools. The browser asks our server, our server asks
Gemini with the key, and the key never leaves the server.
"""
import base64
import json
import os
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import requests
from flask import Blueprint, current_app, g, jsonify, request

from auth import login_required
from models import AiUsage, db
from validate import clean_blocks

bp = Blueprint("ai", __name__)

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

# Which Gemini model to ask first depends on the job (measured on the free tier):
#   "read"  = pull facts out of a file (timetables, exam dates, syllabus).
#             flash-lite answers in ~5 s and is rarely overloaded.
#   "think" = write questions, explain things, give advice. Full flash is
#             smarter, but on the free tier it's often busy, so we fall back
#             to flash-lite quickly instead of making you wait.
MODELS = {
    "read": ["gemini-flash-lite-latest", "gemini-flash-latest", "gemini-2.5-flash-lite"],
    "think": ["gemini-flash-latest", "gemini-flash-lite-latest", "gemini-2.5-flash"],
}
# How long to wait for one model before trying the next (seconds)
TIMEOUTS = {"read": 60, "think": 40}
# If EVERY model was busy, wait this long and go round once more
RETRY_WAITS = [3]  # seconds
BUSY_CODES = {500, 502, 503, 504}
ALLOWED_UPLOADS = {"image/png", "image/jpeg", "image/webp", "image/heic", "application/pdf"}
MAX_UPLOAD_BYTES = 15 * 1024 * 1024  # 15 MB (Gemini accepts up to ~20 MB inline)


class AiError(Exception):
    def __init__(self, message, status=502):
        super().__init__(message)
        self.status = status


# ───────────────────────── talking to Gemini ─────────────────────────
def call_gemini(parts, want_json=False, system=None, task="think"):
    """Send `parts` (text and/or files) to Gemini and return its text answer.
    Busy (503), rate-limited (429) or slow models are skipped straight away
    for the next one, so one overloaded model doesn't make you wait."""
    key = current_app.config["GEMINI_API_KEY"]
    if not key:
        raise AiError("AI isn't set up yet (GEMINI_API_KEY is empty in server/.env).", 503)

    body = {"contents": [{"role": "user", "parts": parts}], "generationConfig": {"temperature": 0.2 if task == "read" else 0.7}}
    if want_json:
        body["generationConfig"]["responseMimeType"] = "application/json"
    if system:
        body["systemInstruction"] = {"parts": [{"text": system}]}

    chosen = current_app.config.get("GEMINI_MODEL") or ""
    models = ([chosen] if chosen else []) + [m for m in MODELS.get(task, MODELS["think"]) if m != chosen]
    last_error = "Unknown error"
    busy = limited = False
    for round_no in range(len(RETRY_WAITS) + 1):
        if round_no:
            time.sleep(current_app.config.get("AI_RETRY_SCALE", 1) * RETRY_WAITS[round_no - 1])
        busy = limited = False
        for model in models:
            try:
                r = requests.post(
                    GEMINI_URL.format(model=model),
                    headers={"x-goog-api-key": key, "Content-Type": "application/json"},
                    json=body,
                    timeout=TIMEOUTS.get(task, 40),
                )
            except requests.Timeout:
                busy = True
                continue  # too slow right now: try the next model
            except requests.RequestException:
                raise AiError("Couldn't reach the AI service. Check your internet connection.")

            if r.status_code in BUSY_CODES:
                busy = True
                continue
            if r.status_code == 429:  # this model's free limit is used up: others have their own
                limited = True
                continue
            if r.status_code == 404:  # model name doesn't exist (anymore)
                last_error = f"Model {model} not found"
                continue
            if r.status_code in (400, 403) and "API key" in r.text:
                raise AiError("The Gemini API key in server/.env isn't valid. Check you copied all of it.", 503)
            if r.status_code == 400:
                raise AiError("The AI couldn't use that file. Try a clearer photo, a screenshot of just the part you need, or a smaller PDF.", 400)
            if not r.ok:
                raise AiError(f"The AI service returned an error ({r.status_code}). Try again.")
            try:
                data = r.json()
                return "".join(p.get("text", "") for p in data["candidates"][0]["content"]["parts"])
            except (KeyError, IndexError, ValueError):
                raise AiError("The AI gave an empty answer. Try again.")
        if not busy:
            break  # nothing was merely busy, so waiting won't help
    if limited and not busy:
        raise AiError("The free AI limit is used up for now. Wait a minute and try again (or tomorrow).", 429)
    if busy or limited:
        raise AiError("Google's free AI is overloaded right now (this happens on the free tier). Wait a minute, then press Try again.", 503)
    raise AiError(f"No working Gemini model found ({last_error}). Set GEMINI_MODEL in server/.env.", 503)


def today_str():
    """Today's date for the daily AI limit. People use Cramwise all over the
    world, so it's UTC by default (set APP_TIMEZONE in .env to change it)."""
    tz = ZoneInfo(os.getenv("APP_TIMEZONE", "UTC"))
    return datetime.now(tz).date().isoformat()


def use_quota():
    """Count one AI request for this user today. Stops at AI_DAILY_LIMIT.
    If the AI call then fails, handle_ai_error gives the request back."""
    today = today_str()
    row = AiUsage.query.filter_by(user_id=g.user.id, day=today).first()
    if not row:
        row = AiUsage(user_id=g.user.id, day=today, count=0)
        db.session.add(row)
    if row.count >= current_app.config["AI_DAILY_LIMIT"]:
        raise AiError("You've used all your AI requests for today. They reset tomorrow.", 429)
    row.count += 1
    db.session.commit()
    g.quota_row_id = row.id


def remaining_today():
    row = AiUsage.query.filter_by(user_id=g.user.id, day=today_str()).first()
    return max(0, current_app.config["AI_DAILY_LIMIT"] - (row.count if row else 0))


@bp.errorhandler(AiError)
def handle_ai_error(err):
    # The AI failed (busy, bad file...): don't charge the user for it
    row_id = g.pop("quota_row_id", None)
    if row_id:
        row = db.session.get(AiUsage, row_id)
        if row and row.count > 0:
            row.count -= 1
            db.session.commit()
    return jsonify(error=str(err)), err.status


# ───────────────────────── routes ─────────────────────────
@bp.get("/api/ai/status")
@login_required
def status():
    return jsonify(enabled=bool(current_app.config["GEMINI_API_KEY"]), remaining=remaining_today())


TIMETABLE_PROMPT = """You are reading a student's WEEKLY timetable from an image or PDF (from anywhere in the world).
It may be a class timetable (lectures, labs, tutorials), a work rota, or a meal timetable (dining hall, canteen, mess).

Return JSON exactly like:
{"blocks": [{"label": "DAA lecture", "kind": "class", "days": [1,3,5], "start": "09:00", "end": "09:50"}]}

Rules:
- days: numbers, 0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday, 6=Saturday.
- start/end: 24-hour "HH:MM".
- kind: "class" for lectures/tutorials, "lab" for labs/practicals, "meal" for breakfast/lunch/snacks/dinner, "other" otherwise.
- label: short (max 40 characters). For meals use exactly "Breakfast", "Lunch", "Snacks" or "Dinner".
- Timetables often write a subject as a course CODE in one place and a NAME in another (e.g. "CS301" = "DBMS" =
  "Database Management Systems"). If the student's subjects are listed below, label each class with the subject
  EXACTLY as the student writes it there, plus the type, e.g. "DBMS lecture", "DBMS lab". Never mix codes and names.
- Days can differ: if a class only happens on some days, or ends earlier on one day, give each its real days and times.
- If the same thing happens at the same time on several days, put it ONCE with all those days.
- Skip empty slots, breaks and free periods.
- If you can't read something, leave it out rather than guessing.
- If there's no timetable in the file, return {"blocks": []}.
- If the file has timetables for many batches/sections and the student says which one is theirs,
  read ONLY that one and ignore all the others.
- Lunch and dinner times printed on the timetable count too: include them as meals."""


@bp.post("/api/ai/timetable")
@login_required
def read_timetable():
    file = request.files.get("file")
    if not file:
        return jsonify(error="No file uploaded."), 400
    if file.mimetype not in ALLOWED_UPLOADS:
        return jsonify(error="Upload a photo (PNG, JPG, WEBP) or a PDF."), 400
    raw = file.read(MAX_UPLOAD_BYTES + 1)
    if len(raw) > MAX_UPLOAD_BYTES:
        return jsonify(error="That file is bigger than 15 MB. Try a screenshot of just your timetable."), 413

    hint = (request.form.get("hint") or "").strip()[:120]
    prompt = TIMETABLE_PROMPT + (f"\n\nWhich timetable is the student's: {hint}" if hint else "")
    prompt += subjects_note(request.form.get("subjects"))

    use_quota()
    text = call_gemini(
        [
            {"text": prompt},
            {"inline_data": {"mime_type": file.mimetype, "data": base64.b64encode(raw).decode()}},
        ],
        want_json=True,
        task="read",
    )
    try:
        blocks = clean_blocks(json.loads(text).get("blocks", []))
    except (ValueError, AttributeError):
        raise AiError("The AI's answer couldn't be understood. Try again or use a clearer photo.")
    return jsonify(blocks=blocks, remaining=remaining_today())


def subjects_note(raw):
    """The student's own subject names (and codes), so the AI can match
    "CS301" to "DBMS" and label things the same way the student does."""
    try:
        items = json.loads(raw or "[]")
    except ValueError:
        return ""
    lines = []
    for x in items[:30] if isinstance(items, list) else []:
        if isinstance(x, dict) and isinstance(x.get("name"), str) and x["name"].strip():
            code = str(x.get("code") or "").strip()[:20]
            lines.append(f"- {x['name'].strip()[:40]}" + (f" (course code {code})" if code else ""))
    return ("\n\nThe student's subjects, written the way they want them:\n" + "\n".join(lines)) if lines else ""


CHAT_SYSTEM = """You are a strict but fair study tutor. The student may be at school, university or learning on their own,
anywhere in the world: match their level and their subject.
Explain clearly and simply, step by step, with small examples. Keep answers focused and not too long.
If the question is not about studying, briefly steer back to studies.
Use plain text with short paragraphs and simple lists. Do not use HTML."""


@bp.post("/api/ai/chat")
@login_required
def chat():
    body = request.get_json(silent=True) or {}
    messages = body.get("messages")
    subject = str(body.get("subject") or "")[:60]
    if not isinstance(messages, list) or not messages:
        return jsonify(error="Type a question first."), 400

    # Keep only the last 10 messages, each trimmed, so requests stay small
    history = []
    for m in messages[-10:]:
        if isinstance(m, dict) and m.get("role") in ("user", "assistant") and isinstance(m.get("text"), str):
            history.append(f"{'Student' if m['role'] == 'user' else 'Tutor'}: {m['text'][:2000]}")
    if not history:
        return jsonify(error="Type a question first."), 400

    use_quota()
    prompt = (f"Subject: {subject}\n\n" if subject else "") + "Conversation so far:\n" + "\n\n".join(history) + "\n\nTutor:"
    answer = call_gemini([{"text": prompt}], system=CHAT_SYSTEM)
    return jsonify(answer=answer.strip(), remaining=remaining_today())


ADVICE_PROMPT = """You are a study coach. Below is a student's study plan as JSON:
subjects with exam dates, chapters done/total, difficulty (1-5) and urgency score (0-100),
plus how many study sessions each subject gets in the next 7 days.

Give 3 to 5 short, specific, practical tips (each under 30 words) about this plan:
what is falling behind, what to prioritise, what is realistic. Mention subjects by name.
Return JSON exactly like: {"tips": ["...", "..."]}"""


@bp.post("/api/ai/advice")
@login_required
def advice():
    body = request.get_json(silent=True) or {}
    summary = body.get("summary")
    if not isinstance(summary, dict):
        return jsonify(error="Nothing to give advice on yet."), 400
    summary_text = json.dumps(summary)[:8000]

    use_quota()
    text = call_gemini([{"text": ADVICE_PROMPT + "\n\nPLAN:\n" + summary_text}], want_json=True)
    try:
        tips = [str(t)[:300] for t in json.loads(text).get("tips", []) if str(t).strip()][:5]
    except (ValueError, AttributeError):
        raise AiError("The AI's answer couldn't be understood. Try again.")
    return jsonify(tips=tips, remaining=remaining_today())


# What KIND of questions suit a subject. Used by quizzes and flashcards.
STYLE_RULES = {
    "auto": """Decide what kind of questions this subject and topic really need:
- If it is learned by SOLVING PROBLEMS only (e.g. calculus, algebra, arithmetic, statistics calculations,
  accounting, physics numericals): ask ONLY problems to work out (calculations, derivations, proofs).
  No definitions, no "what is" questions, no theory.
- If it has BOTH concepts and problems (e.g. physics, chemistry, algorithms, databases/normalization,
  economics, circuits): mix them, roughly half problems and half theory/reasoning.
- If it has no problems to solve (e.g. history, literature, most biology): theory and reasoning only.""",
    "theory": "Ask theory and reasoning questions only (concepts, explanations, comparisons, applying ideas). No calculations.",
    "problems": "Ask ONLY problems to solve (calculations, derivations, tracing an algorithm, proofs). No definitions or theory.",
    "both": "Mix problems to solve and theory/reasoning questions, roughly half and half.",
}

QUIZ_PROMPT = """Make a quiz for a student who wants to be properly challenged.
Subject: {subject}
Topic: {topic}
{chapters}
{style}

Difficulty: MEDIUM to HARD only. No easy recall or trivia, no "what does X stand for".
Questions should need several steps of thinking or working, like a good exam question.
Problems use concrete numbers and can be solved by hand in a few minutes.
Pitch the level to the subject (school, university...), and never ask about things outside the topic.

Write {count} questions. Format: {format}
- "mcq": exactly 4 options and exactly one correct answer. Wrong options must be believable
  (the answers you'd get from common mistakes). "answer" is the index (0-3) of the correct option.
  "explanation": the key steps or reason, 1-4 short sentences.
- "written": the student writes the answer. "modelAnswer": a full worked solution or complete answer
  (short, step by step). "keyPoints": 2-5 short things a marker would look for.
"kind" is "problem" or "theory".

Return JSON exactly like:
{{"questions": [
  {{"type": "mcq", "kind": "problem", "question": "...", "options": ["...", "...", "...", "..."], "answer": 0, "explanation": "..."}},
  {{"type": "written", "kind": "theory", "question": "...", "modelAnswer": "...", "keyPoints": ["...", "..."]}}
]}}
Use plain text only (no HTML, no markdown, no LaTeX): write maths like x^2, sqrt(x), (a+b)/c, integral of x dx."""

FORMATS = {
    "mcq": 'every question is "mcq"',
    "written": 'every question is "written"',
    "mixed": 'about half "mcq" and half "written"',
}


def clean_questions(raw, fmt):
    """Check every question carefully: the AI's answer is untrusted input too."""
    out = []
    for q in raw if isinstance(raw, list) else []:
        if not isinstance(q, dict) or not isinstance(q.get("question"), str) or not q["question"].strip():
            continue
        kind = "problem" if q.get("kind") == "problem" else "theory"
        opts, ans = q.get("options"), q.get("answer")
        is_mcq = (
            isinstance(opts, list) and len(opts) == 4 and all(isinstance(o, (str, int, float)) for o in opts)
            and isinstance(ans, int) and not isinstance(ans, bool) and 0 <= ans < 4
        )
        if q.get("type") != "written" and is_mcq and fmt != "written":
            out.append({
                "type": "mcq", "kind": kind, "question": q["question"][:600],
                "options": [str(o)[:200] for o in opts], "answer": ans,
                "explanation": str(q.get("explanation") or "")[:700],
            })
        elif isinstance(q.get("modelAnswer"), str) and q["modelAnswer"].strip() and fmt != "mcq":
            points = q.get("keyPoints") if isinstance(q.get("keyPoints"), list) else []
            out.append({
                "type": "written", "kind": kind, "question": q["question"][:600],
                "modelAnswer": q["modelAnswer"][:1500],
                "keyPoints": [str(k)[:200] for k in points if str(k).strip()][:5],
            })
    return out


@bp.post("/api/ai/quiz")
@login_required
def quiz():
    body = request.get_json(silent=True) or {}
    subject = str(body.get("subject") or "").strip()[:60]
    topic = str(body.get("topic") or "").strip()[:120]
    if not subject and not topic:
        return jsonify(error="Pick a subject or type a topic first."), 400
    try:
        count = max(3, min(10, int(body.get("count") or 5)))
    except (TypeError, ValueError):
        count = 5
    fmt = body.get("format") if body.get("format") in FORMATS else "mcq"
    style = body.get("style") if body.get("style") in STYLE_RULES else "auto"
    chapters = [str(c)[:80] for c in body.get("chapters") or [] if isinstance(c, str)][:30] if isinstance(body.get("chapters"), list) else []

    use_quota()
    text = call_gemini(
        [{"text": QUIZ_PROMPT.format(
            subject=subject or "general studies",
            topic=topic or "any important topic",
            chapters=("Chapters in this subject: " + "; ".join(chapters)) if chapters else "",
            style=STYLE_RULES[style],
            count=count,
            format=FORMATS[fmt],
        )}],
        want_json=True,
    )
    try:
        questions = clean_questions(json.loads(text).get("questions", []), fmt)
    except (ValueError, AttributeError):
        raise AiError("The AI's quiz couldn't be understood. Try again.")
    if not questions:
        raise AiError("The AI didn't make any usable questions. Try a more specific topic.")
    return jsonify(questions=questions[:count], remaining=remaining_today())


CHECK_PROMPT = """You are a fair but strict examiner. Mark the student's answer.
Question: {question}
Model answer: {model}
Key points: {points}
Student's answer: {answer}

Give a score from 0 to 10. For problems, a correct final answer with the right method is 10; the right method
with a small slip loses a little; a right answer with no working loses some. Be specific and short.
Return JSON exactly like:
{{"score": 7, "verdict": "Mostly right", "feedback": "1-3 sentences on what was good and what was wrong.",
  "missing": ["key point they missed"]}}
Plain text only."""


@bp.post("/api/ai/check")
@login_required
def check_answer():
    """Marks a written answer against the model answer (uses one AI request)."""
    body = request.get_json(silent=True) or {}
    question = str(body.get("question") or "").strip()[:600]
    model = str(body.get("modelAnswer") or "").strip()[:1500]
    answer = str(body.get("answer") or "").strip()[:3000]
    points = [str(k)[:200] for k in body.get("keyPoints") or [] if isinstance(k, str)][:5] if isinstance(body.get("keyPoints"), list) else []
    if not question or not answer:
        return jsonify(error="Write your answer first."), 400
    use_quota()
    text = call_gemini(
        [{"text": CHECK_PROMPT.format(question=question, model=model or "(none)", points="; ".join(points) or "(none)", answer=answer)}],
        want_json=True,
    )
    try:
        data = json.loads(text)
        score = max(0, min(10, int(data.get("score"))))
        missing = data.get("missing") if isinstance(data.get("missing"), list) else []
        return jsonify(
            score=score,
            verdict=str(data.get("verdict") or "")[:60],
            feedback=str(data.get("feedback") or "")[:600],
            missing=[str(m)[:200] for m in missing][:5],
            remaining=remaining_today(),
        )
    except (ValueError, TypeError, AttributeError):
        raise AiError("The AI's marking couldn't be understood. Try again.")


SYLLABUS_PROMPT = """You are reading a course syllabus from a school, college or university anywhere in the world
(it may be an image, a PDF, or pasted text).
Find every SUBJECT/COURSE in it and, for each, its units/modules and the topics inside each unit.

Return JSON exactly like:
{"subjects": [{"name": "Design and Analysis of Algorithms", "code": "ICS 211",
  "units": [{"name": "Unit 1: Asymptotic analysis", "topics": ["Big-O notation", "Recurrences", "Master theorem"]}]}]}

Rules:
- name: the course title as written (max 60 characters). code: the course code if shown, else "".
- units: in the syllabus order. If there are no units, put all topics in one unit named "Topics".
- topics: short names (max 80 characters each), in order. Split long comma lists into separate topics.
- Skip textbooks, references, course outcomes, credits, marks and evaluation schemes.
- If the student says which subjects are theirs (their year, class, course codes, section, programme...), only include those.
- If you can't find a syllabus, return {"subjects": []}."""


def clean_syllabus(data):
    """Make the AI's syllabus answer safe and tidy (it's untrusted input)."""
    out = []
    for s in (data.get("subjects") if isinstance(data, dict) else None) or []:
        if not isinstance(s, dict) or not isinstance(s.get("name"), str) or not s["name"].strip():
            continue
        units = []
        for u in s.get("units") if isinstance(s.get("units"), list) else []:
            if not isinstance(u, dict):
                continue
            raw_topics = u.get("topics") if isinstance(u.get("topics"), list) else []
            topics = [str(t).strip()[:80] for t in raw_topics if isinstance(t, (str, int, float)) and str(t).strip()]
            name = str(u.get("name") or "").strip()[:80]
            if name or topics:
                units.append({"name": name or "Topics", "topics": topics[:40]})
        if units:
            out.append({"name": s["name"].strip()[:60], "code": str(s.get("code") or "").strip()[:20], "units": units[:20]})
    return out[:15]


@bp.post("/api/ai/syllabus")
@login_required
def read_syllabus():
    hint = (request.form.get("hint") or "").strip()[:120]
    text = (request.form.get("text") or "").strip()
    file = request.files.get("file")
    prompt = SYLLABUS_PROMPT + (f"\n\nWhich subjects are the student's: {hint}" if hint else "")

    if file:
        if file.mimetype not in ALLOWED_UPLOADS:
            return jsonify(error="Upload a photo (PNG, JPG, WEBP) or a PDF of the syllabus."), 400
        raw = file.read(MAX_UPLOAD_BYTES + 1)
        if len(raw) > MAX_UPLOAD_BYTES:
            return jsonify(error="That file is bigger than 15 MB. Try a screenshot of just your subjects."), 413
        parts = [{"text": prompt}, {"inline_data": {"mime_type": file.mimetype, "data": base64.b64encode(raw).decode()}}]
    elif text:
        if len(text) > 60000:
            return jsonify(error="That's a lot of text. Paste just your own subjects."), 413
        parts = [{"text": prompt + "\n\nSYLLABUS TEXT:\n" + text}]
    else:
        return jsonify(error="Upload the syllabus or paste its text first."), 400

    use_quota()
    answer = call_gemini(parts, want_json=True, task="read")
    try:
        subjects = clean_syllabus(json.loads(answer))
    except ValueError:
        raise AiError("The AI's answer couldn't be understood. Try again.")
    return jsonify(subjects=subjects, remaining=remaining_today())


EXAMS_PROMPT = """You are reading an EXAM TIMETABLE (also called a date sheet or exam schedule) from a school,
college or university anywhere in the world. It may be an image, a PDF, or pasted text.
Find every exam and its date (and start time if shown).

Return JSON exactly like:
{{"exams": [{{"subject": "Database Management Systems", "code": "CS 301", "date": "2026-12-21", "time": "09:30", "kind": "Final"}}]}}

Rules:
- subject: the course/subject name as written (max 60 characters). code: the course code if shown, else "".
- date: ISO format YYYY-MM-DD. Today is {today}. If the year isn't written, use the next time that date comes after today.
- Dates like 05/12 or 5.12 are ambiguous. The student's region is "{region}": in the US, read them month first (May 12);
  almost everywhere else (India, the UK, Europe, Australia...) day first (5 December). If the timetable itself makes the
  order clear (for example a day above 12, or month names), follow the timetable.
- time: 24-hour HH:MM start time if shown. Morning/afternoon sessions without a time: use the session's start time if
  the timetable states it anywhere, else "". If there's no time, use "".
- kind: what the exam is if stated (Midterm, Final, Practical, Quiz...), else "".
- If the student says which exams are theirs (their year, class, programme, course codes, section...), only include those.
- Skip holidays, reading days and rows without a date.
- If you can't find an exam timetable, return {{"exams": []}}."""


def clean_exams(data):
    """Make the AI's exam timetable answer safe and tidy (it's untrusted input)."""
    out = []
    for e in (data.get("exams") if isinstance(data, dict) else None) or []:
        if not isinstance(e, dict) or not isinstance(e.get("subject"), str) or not e["subject"].strip():
            continue
        day = str(e.get("date") or "").strip()
        try:
            datetime.strptime(day, "%Y-%m-%d")
        except ValueError:
            continue
        t = str(e.get("time") or "").strip()
        if len(t) == 4 and t[1] == ":":
            t = "0" + t
        try:
            datetime.strptime(t, "%H:%M")
        except ValueError:
            t = ""
        out.append({
            "subject": e["subject"].strip()[:60],
            "code": str(e.get("code") or "").strip()[:20],
            "date": day,
            "time": t,
            "kind": str(e.get("kind") or "").strip()[:20],
        })
    return out[:60]


@bp.post("/api/ai/exams")
@login_required
def read_exam_timetable():
    """Reads an exam timetable (date sheet) into a list of exams with dates."""
    hint = (request.form.get("hint") or "").strip()[:120]
    region = (request.form.get("region") or "").strip()[:20] or "unknown"
    today = (request.form.get("today") or "").strip()[:10]
    try:
        datetime.strptime(today, "%Y-%m-%d")
    except ValueError:
        today = datetime.now(ZoneInfo("UTC")).date().isoformat()
    text = (request.form.get("text") or "").strip()
    file = request.files.get("file")
    prompt = EXAMS_PROMPT.format(today=today, region=region) + (f"\n\nWhich exams are the student's: {hint}" if hint else "")

    if file:
        if file.mimetype not in ALLOWED_UPLOADS:
            return jsonify(error="Upload a photo (PNG, JPG, WEBP) or a PDF of the exam timetable."), 400
        raw = file.read(MAX_UPLOAD_BYTES + 1)
        if len(raw) > MAX_UPLOAD_BYTES:
            return jsonify(error="That file is bigger than 15 MB. Try a screenshot of just your exams."), 413
        parts = [{"text": prompt}, {"inline_data": {"mime_type": file.mimetype, "data": base64.b64encode(raw).decode()}}]
    elif text:
        if len(text) > 60000:
            return jsonify(error="That's a lot of text. Paste just your own exams."), 413
        parts = [{"text": prompt + "\n\nEXAM TIMETABLE TEXT:\n" + text}]
    else:
        return jsonify(error="Upload the exam timetable or paste its text first."), 400

    use_quota()
    answer = call_gemini(parts, want_json=True, task="read")
    try:
        exams = clean_exams(json.loads(answer))
    except ValueError:
        raise AiError("The AI's answer couldn't be understood. Try again.")
    return jsonify(exams=exams, remaining=remaining_today())


FLASHCARD_PROMPT = """Make study flashcards for a student who wants to be properly challenged.
Subject: {subject}
Chapter/topic: {topic}
{style}

Difficulty: MEDIUM to HARD. Skip easy recall; test understanding, steps and "why".
For problems: the front is a short problem with concrete numbers, the back is the answer plus the key steps.
Write {count} flashcards.
Front: a short question, prompt or problem (max 200 characters).
Back: a short, clear answer (max 350 characters). Plain text only: no HTML, markdown or LaTeX
(write maths like x^2, sqrt(x), (a+b)/c).
Return JSON exactly like: {{"cards": [{{"front": "...", "back": "..."}}]}}"""


@bp.post("/api/ai/flashcards")
@login_required
def flashcards():
    body = request.get_json(silent=True) or {}
    subject = str(body.get("subject") or "").strip()[:60]
    topic = str(body.get("topic") or "").strip()[:120]
    if not topic:
        return jsonify(error="Type the chapter or topic to make cards for."), 400
    try:
        count = max(4, min(15, int(body.get("count") or 8)))
    except (TypeError, ValueError):
        count = 8

    style = body.get("style") if body.get("style") in STYLE_RULES else "auto"

    use_quota()
    text = call_gemini(
        [{"text": FLASHCARD_PROMPT.format(subject=subject or "general studies", topic=topic, count=count, style=STYLE_RULES[style])}],
        want_json=True,
    )
    try:
        raw = json.loads(text).get("cards", [])
        cards = [
            {"front": str(c["front"]).strip()[:200], "back": str(c["back"]).strip()[:350]}
            for c in raw
            if isinstance(c, dict) and str(c.get("front") or "").strip() and str(c.get("back") or "").strip()
        ]
    except (ValueError, AttributeError, KeyError):
        raise AiError("The AI's cards couldn't be understood. Try again.")
    if not cards:
        raise AiError("The AI didn't make any usable cards. Try a more specific topic.")
    return jsonify(cards=cards[:count], remaining=remaining_today())
