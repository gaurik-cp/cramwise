// "Install app": puts Cramwise on your home screen like a normal app.
//
//   Android / Chrome / Edge: the browser fires "beforeinstallprompt". We keep
//     that event and show its install pop-up when you press our button.
//   iPhone / iPad (Safari): there's no install pop-up, so we show the steps
//     (Share, then Add to Home Screen).
//   Already installed (opened from the home screen): the button hides.
let deferred = null;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // we show our own button instead of the browser's mini-bar
    deferred = e;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
}

export function isInstalled() {
  return window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

// iPhone, iPod, iPad (new iPads say they're a Mac, but they have a touch screen)
export function isIOS() {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

// What kind of install this browser supports: "prompt", "ios" or null
export function installMode() {
  if (isInstalled()) return null;
  if (deferred) return "prompt";
  if (isIOS()) return "ios";
  return null;
}

// Shows the browser's own install pop-up. Returns true if the person installed it.
export async function promptInstall() {
  if (!deferred) return false;
  const e = deferred;
  deferred = null;
  e.prompt();
  const choice = await e.userChoice.catch(() => null);
  notify();
  return choice?.outcome === "accepted";
}

export function onInstallChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
