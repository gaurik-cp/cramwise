// Little helpers for sounds and browser notifications.

// A short arcade-style "ding" made with the Web Audio API (no sound files needed).
// `notes` = list of frequencies played one after another.
export function beep(notes = [660, 880, 1320]) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.12;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.12);
    });
    setTimeout(() => ctx.close(), notes.length * 150 + 200);
  } catch {
    /* sound not available: that's fine */
  }
}

export function notificationsSupported() {
  return typeof window !== "undefined" && "Notification" in window;
}

// Ask once for permission to show notifications. Returns true if allowed.
export async function askNotificationPermission() {
  if (!notificationsSupported()) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  return (await Notification.requestPermission()) === "granted";
}

// Show a notification (only if the person allowed it).
// On phones (Android Chrome) plain `new Notification()` isn't allowed, so we
// go through the service worker when there is one.
export function notify(title, body) {
  if (!notificationsSupported() || Notification.permission !== "granted") return;
  const options = { body, tag: title, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png" };
  const fallback = () => {
    try {
      new Notification(title, options);
    } catch {
      /* some browsers block this in certain modes */
    }
  };
  if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.ready.then((reg) => reg.showNotification(title, options)).catch(fallback);
  } else {
    fallback();
  }
}

// Small localStorage helpers for per-device settings (wrapped in try/catch
// because storage can be blocked in private windows)
export function getSetting(key, fallback = null) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
export function setSetting(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}
