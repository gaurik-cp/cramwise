# Turning on accounts and AI

Cramwise now has a Flask server (`server/`) that does three things:

- **Accounts:** sign in with Google
- **Database:** saves each person's plan, so it's still there when they come back on any device
- **AI:** reads timetable photos, answers study doubts, gives plan advice (Google Gemini, free tier)

Everything already works on your laptop with the **Test login** button. To switch on the real
Google sign-in and the AI, you need two things from Google. Both are free. Paste them into
`server/.env` (open it in VS Code). After saving `.env`, close the "Cramwise server" window and
double-click `START-CRAMWISE.bat` again.

> `server/.env` holds secrets. Never send it to anyone or upload it to GitHub
> (the `.gitignore` file already stops Git from uploading it).

---

## 1. Google sign-in (the "client ID")

1. Go to **console.cloud.google.com** and sign in.
2. At the top, click the project picker, then **New project**. Name it `Cramwise` and click **Create**. Make sure it's selected.
3. In the search bar, type **Google Auth Platform** (older name: "OAuth consent screen") and open it. Click **Get started**.
   - App name: `Cramwise`. Support email: your email.
   - Audience: **External**.
   - Contact email: your email. Agree, then click **Create**.
4. Under **Audience**, find **Test users** and add your own Gmail (and any friends who'll test it).
5. Open **Clients**, then **Create client**:
   - Application type: **Web application**. Name: `Cramwise web`.
   - **Authorized JavaScript origins**: add both `http://localhost:5173` and `http://localhost`.
   - Click **Create**.
6. Copy the **Client ID**. It looks like `1234567890-abc123.apps.googleusercontent.com`.
7. In `server/.env`, set:
   ```
   GOOGLE_CLIENT_ID=1234567890-abc123.apps.googleusercontent.com
   ```

The client ID is not a secret (it's visible in the browser anyway), so you can also just send it to Claude to paste in.

## 2. AI (the Gemini API key)

1. Go to **aistudio.google.com** and sign in.
2. Click **Get API key**, then **Create API key**. Pick the `Cramwise` project if it asks.
3. Copy the key and paste it in `server/.env` yourself:
   ```
   GEMINI_API_KEY=your-key-here
   ```
   **This one IS a secret.** Don't paste it in chats, screenshots or code.

Good to know:
- On the free tier, Google may use what you send to improve its products. Don't upload anything private.
- Each person gets `AI_DAILY_LIMIT` AI requests a day (40 by default), so one person can't use up your free quota.
- If Google renames its models and the AI stops working, put a current model name in `GEMINI_MODEL`.

---

## How the pieces fit

```
Browser (React, :5173) --/api/...--> Flask server (:5050) --> SQLite database (server/instance/cramwise.db)
                                                          \--> Gemini API (with the secret key)
```

- During development, Vite passes every `/api/...` request to Flask (see `vite.config.js`).
- Login: Google gives the browser a signed "ID token". Flask checks it with Google's library,
  then keeps you signed in with an HttpOnly session cookie.
- Security basics already in place:
  - session cookies are HttpOnly and SameSite=Lax
  - the app header `X-Cramwise` blocks CSRF
  - every plan the browser sends is checked before it's saved
  - uploads are limited by type and size
  - the API key stays on the server
  - test login only works from 127.0.0.1
- Tests: `cd server` then `.venv\Scripts\python -m unittest test_app.py`

## Putting it on the internet (later)

When you're ready, the plan is:

1. Run `npm run build`. Flask then serves the built app itself, so one server runs everything.
2. Host the `server/` folder on a Python host (Render, Railway or PythonAnywhere) with a Postgres database.
3. In the host's settings, set:
   - `DATABASE_URL` (the Postgres link)
   - `COOKIE_SECURE=1`
   - `DEV_LOGIN=0`
   - your `GOOGLE_CLIENT_ID` and `GEMINI_API_KEY`
4. Add your real website address to **Authorized JavaScript origins** in Google.
5. Publish the Google app (Audience, then Publish) so anyone can sign in, not just test users.

Once it's online (with https), two things start working fully:

- **Friends**: your friends can sign in from their own phones and add you with your friend code.
- **Install as an app**: on Android Chrome, open the site and tap *Add to home screen* / *Install app*.
  On iPhone Safari: Share, then *Add to Home Screen*. (Phones only allow this on https sites.)

Ask Claude when you want to do this, step by step.
