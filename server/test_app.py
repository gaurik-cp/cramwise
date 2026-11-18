"""
Automatic checks for the server.   Run:  python -m unittest test_app.py

They use a temporary in-memory database and a FAKE Gemini, so they
don't need internet, Google, or an API key.
"""
import io
import json
import unittest
from unittest import mock

from app import create_app

H = {"X-Cramwise": "1"}
PLAN = {
    "userName": "Gauri",
    "subjects": [{"id": "a", "name": "DAA", "difficulty": 5, "examDate": "2026-10-28", "totalChapters": 10, "chaptersDone": 3}],
    "prefs": {
        "hoursPerDay": 4, "dayStart": "07:00", "dayEnd": "22:30", "sessionLength": 50, "breakLength": 10,
        "restDays": [0], "planDays": 14,
        "busy": [
            {"id": "x1", "label": "Lunch", "kind": "meal", "days": [0, 1, 2], "start": "13:00", "end": "14:00"},
            {"id": "x2", "label": "Broken", "kind": "class", "days": [1], "start": "15:00", "end": "14:00"},
        ],
    },
}


class FakeResponse:
    def __init__(self, text, status=200):
        self.status_code, self.ok, self._text = status, status < 400, text
        self.text = text

    def json(self):
        return {"candidates": [{"content": {"parts": [{"text": self._text}]}}]}


class CramwiseTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app({
            "TESTING": True, "SQLALCHEMY_DATABASE_URI": "sqlite://", "DEV_LOGIN": True,
            "GEMINI_API_KEY": "fake-key", "AI_DAILY_LIMIT": 3, "GOOGLE_CLIENT_ID": "", "AI_RETRY_SCALE": 0,
        })
        self.c = self.app.test_client()

    def login(self):
        r = self.c.post("/api/auth/dev", headers=H, environ_base={"REMOTE_ADDR": "127.0.0.1"})
        self.assertEqual(r.status_code, 200)

    def test_config_and_me(self):
        cfg = self.c.get("/api/config", environ_base={"REMOTE_ADDR": "127.0.0.1"}).get_json()
        self.assertTrue(cfg["devLogin"])
        self.assertIsNone(self.c.get("/api/me").get_json()["user"])
        self.login()
        self.assertEqual(self.c.get("/api/me").get_json()["user"]["name"], "Test user")

    def test_dev_login_blocked_from_other_computers(self):
        r = self.c.post("/api/auth/dev", headers=H, environ_base={"REMOTE_ADDR": "10.0.0.5"})
        self.assertEqual(r.status_code, 403)

    def test_csrf_header_required(self):
        self.login()
        r = self.c.put("/api/plan", json={"plan": PLAN})
        self.assertEqual(r.status_code, 403)

    def test_plan_needs_login(self):
        self.assertEqual(self.c.get("/api/plan").status_code, 401)

    def test_plan_save_and_load_drops_broken_blocks(self):
        self.login()
        self.assertIsNone(self.c.get("/api/plan").get_json()["plan"])
        r = self.c.put("/api/plan", json={"plan": PLAN}, headers=H)
        self.assertEqual(r.status_code, 200, r.get_json())
        saved = self.c.get("/api/plan").get_json()["plan"]
        self.assertEqual(saved["subjects"][0]["name"], "DAA")
        self.assertEqual([b["label"] for b in saved["prefs"]["busy"]], ["Lunch"])
        self.assertEqual(saved["prefs"]["busy"][0]["id"], "x1")

    def test_progress_is_kept(self):
        self.login()
        plan = {**PLAN, "progress": {"xp": 120, "done": {"2026-10-03": [{"key": "k", "xp": 50}]}}}
        self.c.put("/api/plan", json={"plan": plan}, headers=H)
        self.assertEqual(self.c.get("/api/plan").get_json()["plan"]["progress"]["xp"], 120)

    def test_bad_plan_rejected(self):
        self.login()
        r = self.c.put("/api/plan", json={"plan": {"subjects": "nope"}}, headers=H)
        self.assertEqual(r.status_code, 400)

    def test_logout(self):
        self.login()
        self.c.post("/api/auth/logout", headers=H)
        self.assertEqual(self.c.get("/api/plan").status_code, 401)

    def test_google_login_not_configured(self):
        r = self.c.post("/api/auth/google", json={"credential": "x"}, headers=H)
        self.assertEqual(r.status_code, 503)

    @mock.patch("ai.requests.post")
    def test_timetable_ai(self, post):
        post.return_value = FakeResponse(json.dumps({"blocks": [
            {"label": "DAA lecture", "kind": "class", "days": [1, 3], "start": "9:00", "end": "09:50"},
            {"label": "Junk", "kind": "class", "days": [9], "start": "10:00", "end": "11:00"},
        ]}))
        self.login()
        r = self.c.post("/api/ai/timetable", headers=H, data={"file": (io.BytesIO(b"\x89PNGfake"), "tt.png", "image/png")},
                        content_type="multipart/form-data")
        body = r.get_json()
        self.assertEqual(r.status_code, 200, body)
        self.assertEqual(body["blocks"], [{"label": "DAA lecture", "kind": "class", "days": [1, 3], "start": "09:00", "end": "09:50"}])
        # the key goes in a header, never in the URL
        self.assertEqual(post.call_args.kwargs["headers"]["x-goog-api-key"], "fake-key")
        self.assertNotIn("fake-key", post.call_args.args[0])

    def test_timetable_rejects_wrong_file_type(self):
        self.login()
        r = self.c.post("/api/ai/timetable", headers=H, data={"file": (io.BytesIO(b"MZ"), "x.exe", "application/octet-stream")},
                        content_type="multipart/form-data")
        self.assertEqual(r.status_code, 400)

    @mock.patch("ai.requests.post")
    def test_model_fallback_on_404(self, post):
        post.side_effect = [FakeResponse("nope", 404), FakeResponse("Recursion is a function calling itself.")]
        self.login()
        r = self.c.post("/api/ai/chat", headers=H, json={"messages": [{"role": "user", "text": "What is recursion?"}]})
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertIn("calling itself", r.get_json()["answer"])
        self.assertEqual(post.call_count, 2)

    @mock.patch("ai.requests.post")
    def test_retries_when_google_is_busy(self, post):
        post.side_effect = [FakeResponse("busy", 503), FakeResponse("busy", 503), FakeResponse("Answer after retry.")]
        self.login()
        r = self.c.post("/api/ai/chat", headers=H, json={"messages": [{"role": "user", "text": "hi"}]})
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertEqual(post.call_count, 3)

    @mock.patch("ai.requests.post")
    def test_overloaded_message(self, post):
        post.return_value = FakeResponse("busy", 503)
        self.login()
        r = self.c.post("/api/ai/chat", headers=H, json={"messages": [{"role": "user", "text": "hi"}]})
        self.assertEqual(r.status_code, 503)
        self.assertIn("overloaded", r.get_json()["error"])

    @mock.patch("ai.requests.post")
    def test_batch_hint_goes_into_prompt(self, post):
        post.return_value = FakeResponse(json.dumps({"blocks": []}))
        self.login()
        self.c.post("/api/ai/timetable", headers=H, data={"hint": "Sem 3 CSE Cyber Security", "file": (io.BytesIO(b"%PDF"), "t.pdf", "application/pdf")},
                    content_type="multipart/form-data")
        sent = post.call_args.kwargs["json"]["contents"][0]["parts"][0]["text"]
        self.assertIn("Sem 3 CSE Cyber Security", sent)

    @mock.patch("ai.requests.post")
    def test_quiz_keeps_only_valid_questions(self, post):
        post.return_value = FakeResponse(json.dumps({"questions": [
            {"question": "Time complexity of binary search?", "options": ["O(n)", "O(log n)", "O(1)", "O(n log n)"], "answer": 1, "explanation": "Halves each step."},
            {"question": "Broken", "options": ["a", "b"], "answer": 0},
            {"question": "Bad answer index", "options": ["a", "b", "c", "d"], "answer": 7},
        ]}))
        self.login()
        r = self.c.post("/api/ai/quiz", headers=H, json={"subject": "DAA", "topic": "searching", "count": 5})
        body = r.get_json()
        self.assertEqual(r.status_code, 200, body)
        self.assertEqual(len(body["questions"]), 1)
        self.assertEqual(body["questions"][0]["answer"], 1)

    @mock.patch("ai.requests.post")
    def test_syllabus_from_text(self, post):
        post.return_value = FakeResponse(json.dumps({"subjects": [
            {"name": "Design and Analysis of Algorithms", "code": "ICS 211", "units": [
                {"name": "Unit 1", "topics": ["Big-O", "Recurrences"]},
                {"name": "", "topics": []}]},
            {"name": "", "units": [{"name": "x", "topics": ["y"]}]},
            {"name": "No units", "units": []},
        ]}))
        self.login()
        r = self.c.post("/api/ai/syllabus", headers=H, data={"text": "DAA: Big-O, recurrences", "hint": "Sem 3"},
                        content_type="multipart/form-data")
        body = r.get_json()
        self.assertEqual(r.status_code, 200, body)
        self.assertEqual(len(body["subjects"]), 1)
        self.assertEqual(body["subjects"][0]["units"], [{"name": "Unit 1", "topics": ["Big-O", "Recurrences"]}])
        self.assertIn("Sem 3", post.call_args.kwargs["json"]["contents"][0]["parts"][0]["text"])

    @mock.patch("ai.requests.post")
    def test_exam_timetable_from_text(self, post):
        post.return_value = FakeResponse(json.dumps({"exams": [
            {"subject": "Databases", "code": "CS 301", "date": "2026-12-21", "time": "9:30", "kind": "Final"},
            {"subject": "Algorithms", "date": "2026-12-23", "time": "afternoon"},
            {"subject": "Bad date", "date": "21/12/2026"},
            {"subject": "", "date": "2026-12-24"},
            "junk",
        ]}))
        self.login()
        r = self.c.post("/api/ai/exams", headers=H, content_type="multipart/form-data",
                        data={"text": "21/12 CS301 Databases 9:30", "hint": "Year 2", "region": "GB", "today": "2026-11-18"})
        body = r.get_json()
        self.assertEqual(r.status_code, 200, body)
        self.assertEqual(body["exams"], [
            {"subject": "Databases", "code": "CS 301", "date": "2026-12-21", "time": "09:30", "kind": "Final"},
            {"subject": "Algorithms", "code": "", "date": "2026-12-23", "time": "", "kind": ""},
        ])
        prompt = post.call_args.kwargs["json"]["contents"][0]["parts"][0]["text"]
        self.assertIn("Today is 2026-11-18", prompt)
        self.assertIn('region is "GB"', prompt)
        self.assertIn("Year 2", prompt)

    def test_exam_timetable_needs_input(self):
        self.login()
        r = self.c.post("/api/ai/exams", headers=H, data={}, content_type="multipart/form-data")
        self.assertEqual(r.status_code, 400)

    def test_no_deadline_subjects_and_exam_times_are_kept(self):
        self.login()
        plan = {**PLAN, "subjects": [
            {"name": "Learn Spanish", "examDate": "", "difficulty": 2, "totalChapters": 20, "chaptersDone": 1},
            {"name": "Physics", "examDate": "2026-12-01", "examTime": "14:00", "totalChapters": 5},
            {"name": "Bad time", "examDate": "2026-12-02", "examTime": "2pm", "totalChapters": 5},
        ]}
        r = self.c.put("/api/plan", json={"plan": plan}, headers=H)
        self.assertEqual(r.status_code, 200, r.get_data(as_text=True))
        saved = {s["name"]: s for s in self.c.get("/api/plan").get_json()["plan"]["subjects"]}
        self.assertEqual(saved["Learn Spanish"]["examDate"], "")
        self.assertEqual(saved["Physics"]["examTime"], "14:00")
        self.assertNotIn("examTime", saved["Bad time"])

    @mock.patch("ai.requests.post")
    def test_rate_limited_model_falls_back_to_next(self, post):
        post.side_effect = [FakeResponse("limit", 429), FakeResponse("Answer from the next model.")]
        self.login()
        r = self.c.post("/api/ai/chat", headers=H, json={"messages": [{"role": "user", "text": "hi"}]})
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertEqual(post.call_count, 2)

    @mock.patch("ai.requests.post")
    def test_reading_jobs_use_the_fast_model_first(self, post):
        post.return_value = FakeResponse(json.dumps({"exams": []}))
        self.login()
        self.c.post("/api/ai/exams", headers=H, data={"text": "x"}, content_type="multipart/form-data")
        self.assertIn("flash-lite", post.call_args.args[0])

    @mock.patch("ai.requests.post")
    def test_mixed_quiz_keeps_mcq_and_written(self, post):
        post.return_value = FakeResponse(json.dumps({"questions": [
            {"type": "mcq", "kind": "problem", "question": "d/dx x^3 at x=2?", "options": ["12", "8", "6", "4"], "answer": 0, "explanation": "3x^2 = 12"},
            {"type": "written", "kind": "theory", "question": "Explain 2NF.", "modelAnswer": "No partial dependency...", "keyPoints": ["partial dependency", "candidate key"]},
            {"type": "written", "question": "No model answer"},
            {"type": "mcq", "question": "bool answer", "options": ["a", "b", "c", "d"], "answer": True},
        ]}))
        self.login()
        r = self.c.post("/api/ai/quiz", headers=H, json={"subject": "Maths", "topic": "derivatives", "format": "mixed", "style": "problems", "chapters": ["Limits"]})
        body = r.get_json()
        self.assertEqual(r.status_code, 200, body)
        self.assertEqual([q["type"] for q in body["questions"]], ["mcq", "written"])
        prompt = post.call_args.kwargs["json"]["contents"][0]["parts"][0]["text"]
        self.assertIn("ONLY problems", prompt)
        self.assertIn("MEDIUM to HARD", prompt)
        self.assertIn("Limits", prompt)

    @mock.patch("ai.requests.post")
    def test_check_written_answer(self, post):
        post.return_value = FakeResponse(json.dumps({"score": 14, "verdict": "Good", "feedback": "Right method.", "missing": ["units"]}))
        self.login()
        r = self.c.post("/api/ai/check", headers=H, json={"question": "q", "modelAnswer": "m", "keyPoints": ["k"], "answer": "my answer"})
        body = r.get_json()
        self.assertEqual(r.status_code, 200, body)
        self.assertEqual(body["score"], 10)  # clamped
        self.assertEqual(self.c.post("/api/ai/check", headers=H, json={"question": "q", "answer": ""}).status_code, 400)

    def test_syllabus_needs_input(self):
        self.login()
        r = self.c.post("/api/ai/syllabus", headers=H, data={}, content_type="multipart/form-data")
        self.assertEqual(r.status_code, 400)

    def test_broken_subjects_are_dropped_and_nan_days_ignored(self):
        self.login()
        plan = {**PLAN, "subjects": PLAN["subjects"] + [{"name": "no date"}, {"name": "bad", "examDate": "soon"}]}
        plan["prefs"] = {**PLAN["prefs"], "busy": [{"label": "x", "kind": "meal", "days": [float("nan"), 2], "start": "13:00", "end": "14:00"}]}
        r = self.c.put("/api/plan", data=json.dumps({"plan": plan}).replace("NaN", "NaN"), headers={**H, "Content-Type": "application/json"})
        self.assertEqual(r.status_code, 200, r.get_data(as_text=True))
        saved = self.c.get("/api/plan").get_json()["plan"]
        # "no date" = no deadline (kept); "soon" isn't a date (dropped)
        self.assertEqual([s["name"] for s in saved["subjects"]], ["DAA", "no date"])
        self.assertEqual(saved["subjects"][1]["examDate"], "")
        self.assertEqual(saved["prefs"]["busy"][0]["days"], [2])

    @mock.patch("ai.requests.post")
    def test_failed_ai_call_gives_the_request_back(self, post):
        post.return_value = FakeResponse("busy", 503)
        self.login()
        self.c.post("/api/ai/chat", headers=H, json={"messages": [{"role": "user", "text": "hi"}]})
        self.assertEqual(self.c.get("/api/ai/status").get_json()["remaining"], 3)

    @mock.patch("ai.requests.post")
    def test_flashcards(self, post):
        post.return_value = FakeResponse(json.dumps({"cards": [
            {"front": "What is a DFA?", "back": "A finite automaton with exactly one transition per symbol."},
            {"front": "", "back": "no front"},
        ]}))
        self.login()
        r = self.c.post("/api/ai/flashcards", headers=H, json={"subject": "TOC", "topic": "DFA"})
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertEqual(len(r.get_json()["cards"]), 1)
        self.assertEqual(self.c.post("/api/ai/flashcards", headers=H, json={"subject": "TOC"}).status_code, 400)

    def test_friends_leaderboard_and_shared_streak(self):
        self.login()
        me = self.c.get("/api/friends?today=2026-10-03").get_json()
        my_code = me["code"]
        self.assertEqual(len(my_code), 8)
        # me: studied 10-02 and 10-03
        plan = {**PLAN, "progress": {"xp": 300, "done": {"2026-10-02": [{"key": "a", "xp": 50}], "2026-10-03": [{"key": "b", "xp": 40}]}}}
        self.c.put("/api/plan", json={"plan": plan}, headers=H)
        # a friend in a second browser
        c2 = self.app.test_client()
        with self.app.app_context():
            from models import User, db
            u = User(google_sub="g-friend", email="f@x.com", name="Ananya K")
            db.session.add(u); db.session.commit(); fid = u.id
        with c2.session_transaction() as sess:
            sess["uid"] = fid
        plan2 = {**PLAN, "progress": {"xp": 50, "done": {"2026-10-03": [{"key": "c", "xp": 120}], "2026-09-20": [{"key": "d", "xp": 999}]}}}
        c2.put("/api/plan", json={"plan": plan2}, headers=H)
        # friend adds me by my code (with a dash and lower case, like people type)
        r = c2.post("/api/friends", headers=H, json={"code": my_code[:4].lower() + "-" + my_code[4:]})
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertEqual(c2.post("/api/friends", headers=H, json={"code": my_code}).status_code, 409)
        self.assertEqual(self.c.post("/api/friends", headers=H, json={"code": my_code}).status_code, 400)
        self.assertEqual(self.c.post("/api/friends", headers=H, json={"code": "ZZZZZZZZ"}).status_code, 404)
        board = self.c.get("/api/friends?today=2026-10-03").get_json()["people"]
        self.assertEqual([p["name"] for p in board], ["Ananya", "Test"])  # 120 XP beats 90 this week
        ananya = board[0]
        self.assertEqual(ananya["weekXp"], 120)  # old 999 XP is outside this week
        self.assertEqual(ananya["sharedStreak"], 1)  # both studied only on 10-03
        self.assertNotIn("email", ananya)
        mine = board[1]
        self.assertEqual((mine["weekXp"], mine["streak"], mine["level"]), (90, 2, 3))  # 300 XP = level 3
        # newer plans log ALL XP per day (cards, revisions, quizzes too)
        plan["progress"]["xpLog"] = {"2026-10-03": 200, "2026-10-01": 75, "2026-09-01": 500, "2026-10-02": 99999}
        self.c.put("/api/plan", json={"plan": plan}, headers=H)
        board = self.c.get("/api/friends?today=2026-10-03").get_json()["people"]
        self.assertEqual(board[0]["name"], "Test")
        self.assertEqual(board[0]["weekXp"], 200 + 75 + 3000)  # silly values are capped per day
        # remove
        self.c.delete(f"/api/friends/{ananya['id']}", headers=H)
        self.assertEqual(len(self.c.get("/api/friends").get_json()["people"]), 1)

    def test_old_database_gets_friend_code_column(self):
        import sqlite3, tempfile, os
        path = os.path.join(tempfile.mkdtemp(), "old.db")
        con = sqlite3.connect(path)
        con.execute("CREATE TABLE users (id INTEGER PRIMARY KEY, google_sub VARCHAR(64) UNIQUE NOT NULL, email VARCHAR(255) NOT NULL, name VARCHAR(255), picture VARCHAR(512), created_at DATETIME)")
        con.commit(); con.close()
        app = create_app({"TESTING": True, "SQLALCHEMY_DATABASE_URI": "sqlite:///" + path})
        with app.app_context():
            from sqlalchemy import inspect
            from models import db
            self.assertIn("friend_code", {c["name"] for c in inspect(db.engine).get_columns("users")})

    @mock.patch("ai.requests.post")
    def test_daily_limit(self, post):
        post.return_value = FakeResponse(json.dumps({"tips": ["Do DAA first."]}))
        self.login()
        for _ in range(3):
            self.assertEqual(self.c.post("/api/ai/advice", headers=H, json={"summary": {"a": 1}}).status_code, 200)
        r = self.c.post("/api/ai/advice", headers=H, json={"summary": {"a": 1}})
        self.assertEqual(r.status_code, 429)
        self.assertEqual(self.c.get("/api/ai/status").get_json()["remaining"], 0)

    def test_phone_app_files_served(self):
        import app as appmod
        if not (appmod.DIST / "manifest.webmanifest").exists():
            self.skipTest("run npm run build first")
        r = self.c.get("/manifest.webmanifest")
        self.assertEqual(r.status_code, 200)
        self.assertIn("manifest+json", r.content_type)
        r = self.c.get("/sw.js")
        self.assertIn("javascript", r.content_type)
        self.assertEqual(r.headers["Cache-Control"], "no-cache")
        r.close()


if __name__ == "__main__":
    unittest.main()
