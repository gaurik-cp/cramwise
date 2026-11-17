"""
Saving and loading each user's plan.

    GET /api/plan   -> { plan: {...} or null, updatedAt }
    PUT /api/plan   <- { plan: {...} }   saves it (replaces the old one)
"""
import json

from flask import Blueprint, g, jsonify, request

from auth import login_required
from models import Plan, db
from validate import MAX_PLAN_BYTES, clean_blocks, clean_changes, clean_subjects, validate_plan

bp = Blueprint("plans", __name__)


@bp.get("/api/plan")
@login_required
def get_plan():
    plan = g.user.plan
    if not plan:
        return jsonify(plan=None, updatedAt=None)
    return jsonify(plan=json.loads(plan.data), updatedAt=plan.updated_at.isoformat())


@bp.put("/api/plan")
@login_required
def save_plan():
    if request.content_length and request.content_length > MAX_PLAN_BYTES:
        return jsonify(error="Plan is too big."), 413
    body = request.get_json(silent=True) or {}
    data = body.get("plan")
    error = validate_plan(data)
    if error:
        return jsonify(error=error), 400

    # Re-check the fixed-week blocks so broken data never gets saved
    prefs = dict(data["prefs"])
    raw_busy = prefs.get("busy") if isinstance(prefs.get("busy"), list) else []
    prefs["busy"] = []
    for i, orig in enumerate(raw_busy[:200]):
        cleaned = clean_blocks([orig])
        if cleaned:  # keep the block's id so the browser can still find it
            block_id = orig.get("id", i) if isinstance(orig, dict) else i
            prefs["busy"].append({**cleaned[0], "id": str(block_id)[:64]})
    prefs["changes"] = clean_changes(prefs.get("changes"))
    progress = data.get("progress") if isinstance(data.get("progress"), dict) else {}
    data = {
        "userName": str(data.get("userName", ""))[:60],
        "subjects": clean_subjects(data["subjects"]),
        "prefs": prefs,
        "progress": progress,  # XP, finished quests, streaks (the game part)
    }

    text = json.dumps(data)
    if len(text) > MAX_PLAN_BYTES:
        return jsonify(error="Plan is too big."), 413

    if g.user.plan:
        g.user.plan.data = text
    else:
        db.session.add(Plan(user_id=g.user.id, data=text))
    db.session.commit()
    return jsonify(ok=True, updatedAt=g.user.plan.updated_at.isoformat())
