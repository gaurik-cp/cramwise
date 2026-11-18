"""
Checks on data coming IN from the browser or the AI.

Rule of thumb (cybersecurity!): never trust input. The browser can be
edited by anyone, and the AI can make mistakes, so the server checks
everything before saving it.
"""
import re

MAX_PLAN_BYTES = 500_000  # a real plan is a few KB; this blocks junk uploads
TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
KINDS = {"class", "lab", "meal", "other"}


def normalize_time(value):
    """'9:00' -> '09:00'. Returns None if it isn't a valid time."""
    if not isinstance(value, str):
        return None
    m = re.match(r"^\s*(\d{1,2})[:.](\d{2})\s*$", value)
    if not m:
        return None
    t = f"{int(m.group(1)):02d}:{m.group(2)}"
    return t if TIME.match(t) else None


def clean_blocks(blocks):
    """Keep only well-formed fixed-week blocks; fix small problems, drop broken ones."""
    if not isinstance(blocks, list):
        return []
    out = []
    for b in blocks[:200]:
        if not isinstance(b, dict):
            continue
        start, end = normalize_time(b.get("start")), normalize_time(b.get("end"))
        days = b.get("days")
        if not start or not end or start >= end or not isinstance(days, list):
            continue
        days = sorted({int(d) for d in days if isinstance(d, (int, float)) and d == d and 0 <= d <= 6})  # d == d skips NaN
        if not days:
            continue
        label = str(b.get("label") or "Busy").strip()[:40] or "Busy"
        kind = b.get("kind") if b.get("kind") in KINDS else "other"
        out.append({"label": label, "kind": kind, "days": days, "start": start, "end": end})
    return out


DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _int(v, fallback, lo, hi):
    try:
        n = round(float(v))
    except (TypeError, ValueError, OverflowError):
        return fallback
    return max(lo, min(hi, n))


def clean_subjects(subjects):
    """Keep only subjects the app can use (a broken exam date would break the
    timetable on every device), and tidy their numbers."""
    out = []
    for s in subjects[:50]:
        if not isinstance(s, dict) or not isinstance(s.get("name"), str) or not s["name"].strip():
            continue
        # examDate "" (or missing) = no exam or deadline, just learning.
        # Anything else must be a real date.
        exam = s.get("examDate") or ""
        if not isinstance(exam, str) or (exam and not DATE.match(exam)):
            continue
        topics = None
        if isinstance(s.get("topics"), list):
            topics = [
                {"name": str(t["name"]).strip()[:80], "done": bool(t.get("done"))}
                for t in s["topics"][:80]
                if isinstance(t, dict) and isinstance(t.get("name"), str) and t["name"].strip()
            ] or None
        total = len(topics) if topics else _int(s.get("totalChapters"), 1, 1, 500)
        done = sum(t["done"] for t in topics) if topics else _int(s.get("chaptersDone"), 0, 0, total)
        clean = {
            "id": str(s.get("id") or "")[:64] or f"s{len(out)}",
            "name": s["name"].strip()[:40],
            "examDate": exam,
            "difficulty": _int(s.get("difficulty"), 3, 1, 5),
            "totalChapters": total,
            "chaptersDone": done,
            "color": str(s.get("color") or "")[:16],
        }
        if isinstance(s.get("examTime"), str) and TIME.match(s["examTime"]):
            clean["examTime"] = s["examTime"]
        if topics:
            clean["topics"] = topics
        out.append(clean)
    return out


def clean_changes(changes):
    """One-off changes for single dates ("day off just this once", "busy 4-8pm
    tomorrow"). Keep only well-formed ones."""
    if not isinstance(changes, dict):
        return {}
    out = {}
    for date, c in list(changes.items())[:120]:
        if not isinstance(date, str) or not DATE.match(date) or not isinstance(c, dict):
            continue
        clean = {}
        if c.get("off") is True:
            clean["off"] = True
        if "hours" in c:
            hours = _int(c.get("hours"), None, 1, 14)
            if hours is not None:
                clean["hours"] = hours
        busy = []
        for b in (c.get("busy") if isinstance(c.get("busy"), list) else [])[:20]:
            if not isinstance(b, dict):
                continue
            start, end = normalize_time(b.get("start")), normalize_time(b.get("end"))
            if start and end and start < end:
                busy.append({
                    "id": str(b.get("id") or "")[:64],
                    "label": str(b.get("label") or "Busy").strip()[:40] or "Busy",
                    "kind": "other",
                    "start": start,
                    "end": end,
                })
        if busy:
            clean["busy"] = busy
        if clean:
            out[date] = clean
    return out


def validate_plan(plan):
    """Returns an error message, or None if the plan looks OK."""
    if not isinstance(plan, dict):
        return "Plan must be a JSON object."
    if not isinstance(plan.get("subjects"), list):
        return "Plan needs a list of subjects."
    if not isinstance(plan.get("prefs"), dict):
        return "Plan needs prefs."
    if len(plan["subjects"]) > 50:
        return "Too many subjects (max 50)."
    if "progress" in plan and not isinstance(plan["progress"], (dict, type(None))):
        return "Progress must be an object."
    return None
