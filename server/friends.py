"""
Friends: add each other with a friend code, see a weekly XP leaderboard
and keep shared streaks.

    GET    /api/friends            your code + leaderboard (you + friends)
    POST   /api/friends            { code }  add a friend
    DELETE /api/friends/<id>       remove a friend

Privacy: friends only see your name, level, XP this week and streaks.
Never your email, subjects or timetable.
"""
import json
import secrets
from datetime import date, timedelta

from flask import Blueprint, g, jsonify, request

from auth import login_required
from models import Friendship, User, db

bp = Blueprint("friends", __name__)

CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O or 1/I, easy to read out loud
MAX_FRIENDS = 50


def ensure_code(user):
    if not user.friend_code:
        while True:
            code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(8))
            if not User.query.filter_by(friend_code=code).first():
                break
        user.friend_code = code
        db.session.commit()
    return user.friend_code


def _done_days(user):
    """{ "2026-10-03": xp earned that day } from the user's saved plan."""
    if not user.plan:
        return {}
    try:
        done = json.loads(user.plan.data).get("progress", {}).get("done", {})
    except (ValueError, AttributeError):
        return {}
    out = {}
    for day, quests in (done or {}).items():
        if isinstance(quests, list) and quests:
            out[day] = sum(int(q.get("xp", 0)) for q in quests if isinstance(q, dict))
    return out


def _week_xp(user, done_days, week):
    """XP earned in the last 7 days. Uses the per-day XP log (counts quests,
    revisions, cards and quizzes); older plans without it fall back to quests."""
    try:
        log = json.loads(user.plan.data).get("progress", {}).get("xpLog") if user.plan else None
    except (ValueError, AttributeError):
        log = None
    if isinstance(log, dict) and log:
        total = 0
        for d, v in log.items():
            if d in week and isinstance(v, (int, float)):
                total += max(0, min(int(v), 3000))  # a day can't be worth more than 3000 XP
        return total
    return sum(xp for d, xp in done_days.items() if d in week)


def _streak(days_with_study, today):
    day = today if today.isoformat() in days_with_study else today - timedelta(days=1)
    n = 0
    while day.isoformat() in days_with_study:
        n += 1
        day -= timedelta(days=1)
    return n


def _total_xp(user):
    try:
        return int(json.loads(user.plan.data).get("progress", {}).get("xp", 0)) if user.plan else 0
    except (ValueError, AttributeError, TypeError):
        return 0


def _level(xp):
    level = 1
    while xp >= 100 * level * (level + 1) // 2:
        level += 1
    return level


def _friend_ids(user):
    rows = Friendship.query.filter((Friendship.user_id == user.id) | (Friendship.friend_id == user.id)).all()
    return {r.friend_id if r.user_id == user.id else r.user_id for r in rows}


@bp.get("/api/friends")
@login_required
def leaderboard():
    # The browser sends ITS date (so the week matches the student's timezone)
    try:
        today = date.fromisoformat(request.args.get("today") or "")
    except ValueError:
        today = date.today()
    week = {(today - timedelta(days=i)).isoformat() for i in range(7)}
    me_days = _done_days(g.user)

    people = []
    for u in [g.user] + User.query.filter(User.id.in_(_friend_ids(g.user))).all():
        days = _done_days(u) if u.id != g.user.id else me_days
        both = set(days) & set(me_days)  # days you BOTH studied
        people.append({
            "id": u.id,
            "name": (u.name or "Player").split(" ")[0][:30],
            "you": u.id == g.user.id,
            "weekXp": _week_xp(u, days, week),
            "streak": _streak(set(days), today),
            "sharedStreak": None if u.id == g.user.id else _streak(both, today),
            "level": _level(_total_xp(u)),
        })
    people.sort(key=lambda p: (-p["weekXp"], p["name"]))
    return jsonify(code=ensure_code(g.user), people=people)


@bp.post("/api/friends")
@login_required
def add_friend():
    code = str((request.get_json(silent=True) or {}).get("code") or "").strip().upper().replace(" ", "").replace("-", "")
    if len(code) != 8:
        return jsonify(error="Friend codes are 8 letters/numbers, like K7MPQ2XR."), 400
    friend = User.query.filter_by(friend_code=code).first()
    if not friend:
        return jsonify(error="No one has that friend code. Check it with your friend."), 404
    if friend.id == g.user.id:
        return jsonify(error="That's your own code."), 400
    ids = _friend_ids(g.user)
    if friend.id in ids:
        return jsonify(error=f"You're already friends with {(friend.name or 'them').split(' ')[0]}."), 409
    if len(ids) >= MAX_FRIENDS:
        return jsonify(error=f"You can have up to {MAX_FRIENDS} friends."), 400
    db.session.add(Friendship(user_id=g.user.id, friend_id=friend.id))
    db.session.commit()
    return jsonify(ok=True, name=(friend.name or "Player").split(" ")[0])


@bp.delete("/api/friends/<int:friend_id>")
@login_required
def remove_friend(friend_id):
    Friendship.query.filter(
        ((Friendship.user_id == g.user.id) & (Friendship.friend_id == friend_id))
        | ((Friendship.user_id == friend_id) & (Friendship.friend_id == g.user.id))
    ).delete()
    db.session.commit()
    return jsonify(ok=True)
