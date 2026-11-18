"""
AI features, using Google's Gemini API (free tier).

    GET  /api/ai/status      is AI set up? how many requests left today?
    POST /api/ai/timetable   upload a timetable photo/PDF -> fixed-week blocks
    POST /api/ai/chat        ask a study doubt
    POST /api/ai/advice      tips about your current plan
    POST /api/ai/quiz        a multiple-choice quiz on a topic
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
# If the chosen model name stops working (Google renames models often), try these next.
FALLBACK_MODELS = ["gemini-flash-latest", "gemini-flash-lite-latest", "gemini-2.5-flash"]
# Google's free tier is sometimes "overloaded" (error 503). We wait and retry
# a couple of times, then try a lighter model, before giving up.
RETRY_WAITS = [2, 5]  # seconds
BUSY_CODES = {500, 502, 503, 504}
ALLOWED_UPLOADS = {"image/png", "image/jpeg", "image/webp", "image/heic", "application/pdf"}
MAX_UPLOAD_BYTES = 15 * 1024 * 1024  # 15 MB (Gemini accepts up to ~20 MB inline)


class AiError(Exception):
    def __init__(self, message, status=502):
        super().__init__(message)
        self.status = status


# ───────────────────────── talking to Gemini ─────────────────────────
def call_gemini(parts, want_json=False, system=None):
    """Send `parts` (text and/or files) to Gemini and return its text answer."""
    key = current_app.config["GEMINI_API_KEY"]
    if not key:
        raise AiError("AI isn't set up yet (GEMINI_API_KEY is empty in server/.env).", 503)

    body = {"contents": [{"role": "user", "parts": parts}], "generationConfig": {"temperature": 0.2}}
    if want_json:
        body["generationConfig"]["responseMimeType"] = "application/json"
    if system:
        body["systemInstruction"] = {"parts": [{"text": system}]}

    models = [current_app.config["GEMINI_MODEL"]] + [m for m in FALLBACK_MODELS if m != current_app.config["GEMINI_MODEL"]]
    last_error = "Unknown error"
    overloaded = False
    for model in models:
        for attempt in range(len(RETRY_WAITS) + 1):
            try:
                r = requests.post(
                    GEMINI_URL.format(model=model),
                    headers={"x-goog-api-key": key, "Content-Type": "application/json"},
                    json=body,
                    timeout=90,
                )
            except requests.Timeout:
                overloaded = True
                break  # this model is too slow right now: try the next one
            except requests.RequestException:
                raise AiError("Couldn't reach the AI service. Check your internet connection.")

            if r.status_code in BUSY_CODES:
                overloaded = True
                if attempt < len(RETRY_WAITS):
                    time.sleep(current_app.config.get("AI_RETRY_SCALE", 1) * RETRY_WAITS[attempt])
                    continue
                break  # still busy: try the next model
            if r.status_code == 404:  # model name doesn't exist (anymore): try the next one
                last_error = f"Model {model} not found"
                break
            if r.status_code == 429:
                raise AiError("The free AI limit is used up for now. Wait a minute and try again (or tomorrow).", 429)
            if r.status_code in (400, 403) and "API key" in r.text:
                raise AiError("The Gemini API key in server/.env isn't valid. Check you copied all of it.", 503)
            if r.status_code == 400:
                raise AiError("The AI couldn't use that file. Try a clearer photo, a screenshot of just your timetable, or a smaller PDF.", 400)
            if not r.ok:
                raise AiError(f"The AI service returned an error ({r.status_code}). Try again.")
            try:
                data = r.json()
                return "".join(p.get("text", "") for p in data["candidates"][0]["content"]["parts"])
            except (KeyError, IndexError, ValueError):
                raise AiError("The AI gave an empty answer. Try again.")
    if overloaded:
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


TIMETABLE_PROMPT = """You are reading a student's timetable from an image or PDF.
It may be a class timetable (lectures, labs, tutorials) or a mess/canteen timetable (meal timings).

Return JSON exactly like:
{"blocks": [{"label": "DAA lecture", "kind": "class", "days": [1,3,5], "start": "09:00", "end": "09:50"}]}

Rules:
- days: numbers, 0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday, 6=Saturday.
- start/end: 24-hour "HH:MM".
- kind: "class" for lectures/tutorials, "lab" for labs/practicals, "meal" for breakfast/lunch/snacks/dinner, "other" otherwise.
- label: short, use the subject code or name shown (max 40 characters). For meals use "Breakfast", "Lunch", "Snacks", "Dinner".
- If the same thing happens at the same time on several days, put it ONCE with all those days.
- Skip empty slots, breaks and free periods.
- If you can't read something, leave it out rather than guessing.
- If there's no timetable in the file, return {"blocks": []}.
- If the file has timetables for many batches/sections and the student says which one is theirs,
  read ONLY that one and ignore all the others."""


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
    prompt = TIMETABLE_PROMPT + (f"\n\nThe student's batch/section is: {hint}" if hint else "")

    use_quota()
    text = call_gemini(
        [
            {"text": prompt},
            {"inline_data": {"mime_type": file.mimetype, "data": base64.b64encode(raw).decode()}},
        ],
        want_json=True,
    )
    try:
        blocks = clean_blocks(json.loads(text).get("blocks", []))
    except (ValueError, AttributeError):
        raise AiError("The AI's answer couldn't be understood. Try again or use a clearer photo.")
    return jsonify(blocks=blocks, remaining=remaining_today())


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


QUIZ_PROMPT = """Make a multiple-choice quiz for a student (pitch it at the level the subject and topic suggest).
Subject: {subject}
Topic: {topic}

Write {count} questions that test real understanding (not trivia), from easy to harder.
Each question has exactly 4 options and exactly one correct answer.
Return JSON exactly like:
{{"questions": [{{"question": "...", "options": ["...", "...", "...", "..."], "answer": 0, "explanation": "..."}}]}}
"answer" is the index (0-3) of the correct option. Keep the explanation to 1-2 short sentences.
Use plain text only (no HTML, no markdown)."""


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

    use_quota()
    text = call_gemini(
        [{"text": QUIZ_PROMPT.format(subject=subject or "general studies", topic=topic or "any important topic", count=count)}],
        want_json=True,
    )
    # Check every question carefully: the AI's answer is untrusted input too
    questions = []
    try:
        for q in json.loads(text).get("questions", []):
            opts = q.get("options")
            ans = q.get("answer")
            if (
                isinstance(q.get("question"), str)
                and isinstance(opts, list)
                and len(opts) == 4
                and all(isinstance(o, (str, int, float)) for o in opts)
                and isinstance(ans, int)
                and 0 <= ans < 4
            ):
                questions.append({
                    "question": q["question"][:500],
                    "options": [str(o)[:200] for o in opts],
                    "answer": ans,
                    "explanation": str(q.get("explanation") or "")[:500],
                })
    except (ValueError, AttributeError):
        raise AiError("The AI's quiz couldn't be understood. Try again.")
    if not questions:
        raise AiError("The AI didn't make any usable questions. Try a more specific topic.")
    return jsonify(questions=questions[:count], remaining=remaining_today())


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
    answer = call_gemini(parts, want_json=True)
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
    answer = call_gemini(parts, want_json=True)
    try:
        exams = clean_exams(json.loads(answer))
    except ValueError:
        raise AiError("The AI's answer couldn't be understood. Try again.")
    return jsonify(exams=exams, remaining=remaining_today())


FLASHCARD_PROMPT = """Make study flashcards for a student (pitch them at the level the subject and topic suggest).
Subject: {subject}
Chapter/topic: {topic}

Write {count} flashcards covering the most important definitions, formulas, steps and "why" questions.
Front: a short question or prompt (max 150 characters).
Back: a short, clear answer (max 300 characters). Use plain text, no HTML, no markdown.
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

    use_quota()
    text = call_gemini([{"text": FLASHCARD_PROMPT.format(subject=subject or "general studies", topic=topic, count=count)}], want_json=True)
    try:
        raw = json.loads(text).get("cards", [])
        cards = [
            {"front": str(c["front"]).strip()[:150], "back": str(c["back"]).strip()[:300]}
            for c in raw
            if isinstance(c, dict) and str(c.get("front") or "").strip() and str(c.get("back") or "").strip()
        ]
    except (ValueError, AttributeError, KeyError):
        raise AiError("The AI's cards couldn't be understood. Try again.")
    if not cards:
        raise AiError("The AI didn't make any usable cards. Try a more specific topic.")
    return jsonify(cards=cards[:count], remaining=remaining_today())
