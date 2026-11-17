// Small helper for talking to our Flask server.
// Every request:
//   • sends the login cookie (credentials: "same-origin")
//   • adds the "X-Cramwise: 1" header the server requires (CSRF protection)
//   • turns server errors into normal JavaScript errors with a readable message

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function api(path, { method = "GET", json, form } = {}) {
  const headers = { "X-Cramwise": "1" };
  let body;
  if (json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  } else if (form) {
    body = form; // FormData (for file uploads): the browser sets the content type itself
  }

  let res;
  try {
    res = await fetch(path, { method, headers, body, credentials: "same-origin" });
  } catch {
    throw new ApiError("Can't reach the Cramwise server. Is it running?", 0);
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* not JSON */
  }
  if (!res.ok) throw new ApiError(data?.error || `Server error (${res.status})`, res.status);
  return data;
}

// Loads Google's sign-in script once (only when needed)
let googleScript;
export function loadGoogleScript() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!googleScript) {
    googleScript = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.onload = resolve;
      s.onerror = () => reject(new Error("Couldn't load Google sign-in. Check your internet."));
      document.head.appendChild(s);
    });
  }
  return googleScript;
}
