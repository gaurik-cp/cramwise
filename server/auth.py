"""
Sign-in with Google.

How it works, step by step:
  1. The browser shows Google's "Sign in with Google" button.
  2. When you sign in, Google gives the browser an "ID token": a small
     signed message saying "this is user X, email Y".
  3. The browser sends that token to POST /api/auth/google.
  4. We ask Google's library to CHECK the token's signature and that it
     was made for OUR app (the client ID). A fake token fails here.
  5. We find or create the user in the database and remember them in a
     session cookie (signed by our SECRET_KEY, so it can't be forged,
     and HttpOnly, so page JavaScript can't read it).
"""
from functools import wraps

from flask import Blueprint, current_app, g, jsonify, request, session
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token

from models import User, db

bp = Blueprint("auth", __name__)


def current_user():
    uid = session.get("uid")
    return db.session.get(User, uid) if uid else None


def login_required(view):
    """Put @login_required above a route to block people who aren't signed in."""

    @wraps(view)
    def wrapper(*args, **kwargs):
        user = current_user()
        if not user:
            return jsonify(error="Please sign in first."), 401
        g.user = user
        return view(*args, **kwargs)

    return wrapper


def _dev_login_allowed():
    # Only if turned on in .env AND the request comes from this very computer.
    return current_app.config["DEV_LOGIN"] and request.remote_addr in ("127.0.0.1", "::1")


@bp.get("/api/config")
def config():
    """Public settings the browser needs before anyone signs in."""
    return jsonify(
        googleClientId=current_app.config["GOOGLE_CLIENT_ID"] or None,
        devLogin=_dev_login_allowed(),
        aiEnabled=bool(current_app.config["GEMINI_API_KEY"]),
    )


@bp.get("/api/me")
def me():
    user = current_user()
    return jsonify(user=user.to_public() if user else None)


def _sign_in(sub, email, name="", picture=""):
    user = User.query.filter_by(google_sub=sub).first()
    if not user:
        user = User(google_sub=sub, email=email)
        db.session.add(user)
    user.email, user.name, user.picture = email, name or "", picture or ""
    db.session.commit()
    session.clear()  # fresh session on login (stops "session fixation" attacks)
    session["uid"] = user.id
    session.permanent = True
    return user


@bp.post("/api/auth/google")
def google_login():
    client_id = current_app.config["GOOGLE_CLIENT_ID"]
    if not client_id:
        return jsonify(error="Google sign-in isn't set up yet (GOOGLE_CLIENT_ID is empty in server/.env)."), 503

    token = (request.get_json(silent=True) or {}).get("credential")
    if not token or not isinstance(token, str):
        return jsonify(error="Missing Google credential."), 400
    try:
        info = id_token.verify_oauth2_token(token, google_requests.Request(), client_id)
    except ValueError:
        return jsonify(error="Google sign-in couldn't be verified. Try again."), 401
    if not info.get("email_verified"):
        return jsonify(error="Your Google email isn't verified."), 401

    user = _sign_in(info["sub"], info["email"], info.get("name", ""), info.get("picture", ""))
    return jsonify(user=user.to_public())


@bp.post("/api/auth/dev")
def dev_login():
    """Test login for your own laptop only (see DEV_LOGIN in .env)."""
    if not _dev_login_allowed():
        return jsonify(error="Dev login is off."), 403
    user = _sign_in("dev-local-user", "you@localhost", "Test user")
    return jsonify(user=user.to_public())


@bp.post("/api/auth/logout")
def logout():
    session.clear()
    return jsonify(ok=True)
