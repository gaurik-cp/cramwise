"""
Database tables (using SQLAlchemy, which turns Python classes into SQL tables).

    users     one row per person who signs in with Google
    plans     one row per user: their whole Cramwise plan saved as JSON text
    ai_usage  how many AI requests each user made on each day (for the daily limit)

Why store the plan as one JSON blob instead of many tables?
The plan is always loaded and saved as a whole by one person, so one row
per user is simple and fast. If later you want to search across subjects
(e.g. "how many users study DBMS"), you could split it into tables.
"""
from datetime import datetime, timezone

from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


def utcnow():
    return datetime.now(timezone.utc)


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    # "sub" = Google's permanent ID for this account. Emails can change, sub can't.
    google_sub = db.Column(db.String(64), unique=True, nullable=False, index=True)
    email = db.Column(db.String(255), nullable=False)
    name = db.Column(db.String(255), default="")
    picture = db.Column(db.String(512), default="")
    friend_code = db.Column(db.String(8), unique=True, index=True)  # share this to add friends
    created_at = db.Column(db.DateTime(timezone=True), default=utcnow)

    plan = db.relationship("Plan", back_populates="user", uselist=False, cascade="all, delete-orphan")

    def to_public(self):
        """Only the fields the browser is allowed to see."""
        return {"id": self.id, "email": self.email, "name": self.name, "picture": self.picture}


class Plan(db.Model):
    __tablename__ = "plans"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), unique=True, nullable=False)
    data = db.Column(db.Text, nullable=False)  # the plan as JSON text
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    user = db.relationship("User", back_populates="plan")


class AiUsage(db.Model):
    __tablename__ = "ai_usage"
    __table_args__ = (db.UniqueConstraint("user_id", "day"),)

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    day = db.Column(db.String(10), nullable=False)  # "2026-10-03"
    count = db.Column(db.Integer, default=0, nullable=False)


class Friendship(db.Model):
    """One row per pair of friends (works both ways)."""
    __tablename__ = "friendships"
    __table_args__ = (db.UniqueConstraint("user_id", "friend_id"),)

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    friend_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    created_at = db.Column(db.DateTime(timezone=True), default=utcnow)
