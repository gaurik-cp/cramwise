"""
Cramwise server (Flask).

Run it:   python app.py      (then it listens on http://127.0.0.1:5050)

While developing, Vite (the React side) runs on :5173 and passes every
/api/... request through to this server (see vite.config.js "proxy").
When you put the site online, `npm run build` makes a dist/ folder and
this server hands out those files too, so ONE server runs everything.
"""
import mimetypes
import os
import secrets
from datetime import timedelta
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory

from models import db

# Windows sometimes doesn't know these file types, which breaks "install app"
mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("text/javascript", ".js")

HERE = Path(__file__).resolve().parent
DIST = HERE.parent / "dist"
load_dotenv(HERE / ".env")


def _secret_key(instance_dir: Path) -> str:
    """Use SECRET_KEY from .env, or make a random one once and keep it in instance/."""
    if os.getenv("SECRET_KEY"):
        return os.environ["SECRET_KEY"]
    path = instance_dir / "secret_key"
    if not path.exists():
        path.write_text(secrets.token_hex(32))
    return path.read_text().strip()


def _add_missing_columns():
    """Older databases don't have newer columns yet. Add them (tiny 'migration')."""
    from sqlalchemy import inspect, text

    cols = {c["name"] for c in inspect(db.engine).get_columns("users")}
    if "friend_code" not in cols:
        with db.engine.begin() as conn:
            conn.execute(text("ALTER TABLE users ADD COLUMN friend_code VARCHAR(8)"))
            conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_friend_code ON users (friend_code)"))


def create_app(test_config=None):
    app = Flask(__name__, instance_path=str(HERE / "instance"), static_folder=None)
    Path(app.instance_path).mkdir(exist_ok=True)

    db_url = os.getenv("DATABASE_URL") or f"sqlite:///{Path(app.instance_path) / 'cramwise.db'}"
    if db_url.startswith("postgres://"):  # some hosts give the old-style name
        db_url = db_url.replace("postgres://", "postgresql://", 1)

    app.config.update(
        SECRET_KEY=_secret_key(Path(app.instance_path)),
        SQLALCHEMY_DATABASE_URI=db_url,
        GOOGLE_CLIENT_ID=os.getenv("GOOGLE_CLIENT_ID", "").strip(),
        GEMINI_API_KEY=os.getenv("GEMINI_API_KEY", "").strip(),
        GEMINI_MODEL=os.getenv("GEMINI_MODEL", "").strip(),  # optional: force one model first
        AI_DAILY_LIMIT=int(os.getenv("AI_DAILY_LIMIT", "40")),
        DEV_LOGIN=os.getenv("DEV_LOGIN", "0") == "1",
        # Login cookie settings:
        SESSION_COOKIE_HTTPONLY=True,  # page JavaScript can't read it (stops cookie theft via XSS)
        SESSION_COOKIE_SAMESITE="Lax",  # other websites can't send it with their requests
        SESSION_COOKIE_SECURE=os.getenv("COOKIE_SECURE", "0") == "1",  # https only, when online
        PERMANENT_SESSION_LIFETIME=timedelta(days=30),
        MAX_CONTENT_LENGTH=16 * 1024 * 1024,  # refuse anything over 16 MB
    )
    if test_config:
        app.config.update(test_config)

    db.init_app(app)

    from ai import bp as ai_bp
    from auth import bp as auth_bp
    from plans import bp as plans_bp
    from friends import bp as friends_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(plans_bp)
    app.register_blueprint(ai_bp)
    app.register_blueprint(friends_bp)

    with app.app_context():
        db.create_all()  # makes the tables the first time
        _add_missing_columns()

    # ── CSRF protection ──
    # Every request that CHANGES something must carry the header "X-Cramwise: 1".
    # Our own page always adds it. Another website can't add custom headers to a
    # request to us (the browser blocks it), so it can't make you do things.
    @app.before_request
    def require_app_header():
        if request.path.startswith("/api/") and request.method in ("POST", "PUT", "PATCH", "DELETE"):
            if request.headers.get("X-Cramwise") != "1":
                return jsonify(error="Missing app header."), 403

    @app.after_request
    def security_headers(resp):
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        resp.headers.setdefault("X-Frame-Options", "DENY")
        return resp

    @app.errorhandler(413)
    def too_big(_):
        return jsonify(error="That upload is too big."), 413

    # ── Serve the built React app (only when dist/ exists, i.e. after `npm run build`) ──
    @app.get("/", defaults={"path": ""})
    @app.get("/<path:path>")
    def frontend(path):
        if path.startswith("api/"):
            return jsonify(error="Not found."), 404
        if not DIST.exists():
            return "Cramwise API is running. Open the app at http://localhost:5173", 200
        file = DIST / path
        if path and file.is_file():
            res = send_from_directory(DIST, path)
            if path in ("sw.js", "manifest.webmanifest"):
                res.headers["Cache-Control"] = "no-cache"  # so app updates reach phones
            return res
        res = send_from_directory(DIST, "index.html")
        res.headers["Cache-Control"] = "no-cache"
        return res

    return app


if __name__ == "__main__":
    app = create_app()
    print("\n  Cramwise server running on http://127.0.0.1:5050")
    print(f"  Google sign-in: {'ON' if app.config['GOOGLE_CLIENT_ID'] else 'not set up yet'}")
    print(f"  AI (Gemini):    {'ON' if app.config['GEMINI_API_KEY'] else 'not set up yet'}")
    print(f"  Dev login:      {'ON (this computer only)' if app.config['DEV_LOGIN'] else 'off'}\n")
    app.run(host="127.0.0.1", port=5050, debug=False)
