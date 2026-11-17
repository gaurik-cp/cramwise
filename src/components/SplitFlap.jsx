// ─────────────────────────────────────────────────────────────
// SPLIT-FLAP TEXT (like an old airport / railway departures board)
//
// Shows `text` in fixed-size tiles, one letter per tile.
// When the text changes, every tile whose letter changed "spins"
// through random letters for a moment, then lands on the new one.
//
// How it works:
//   • `shown` = the letters on screen right now
//   • `spins` = how many more random letters each tile shows before
//     it lands (counts down every tick)
//   • one timer ticks every 55ms and updates all spinning tiles
//   • `flips` = a counter per tile; changing it gives the letter a new
//     React key, which re-runs the little CSS flip animation
// ─────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";

const CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const TICK_MS = 55;

// Pad/cut the text so it always fills exactly `size` tiles
function fit(text, size, align) {
  const t = String(text).toUpperCase().slice(0, size);
  return align === "right" ? t.padStart(size, " ") : t.padEnd(size, " ");
}

const reduceMotion =
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function SplitFlap({ text, size, align = "left", delay = 0, tone }) {
  const target = fit(text, size, align);
  const [shown, setShown] = useState(() => (reduceMotion ? target : " ".repeat(size)));
  const [flips, setFlips] = useState(() => Array(size).fill(0));
  const shownRef = useRef(shown);
  shownRef.current = shown;

  useEffect(() => {
    if (reduceMotion) {
      setShown(target);
      return;
    }

    // Decide how long each changed tile spins. Later tiles spin a bit
    // longer, so the word settles left-to-right like a real board.
    const current = shownRef.current;
    const spins = [...target].map((ch, i) =>
      ch === current[i] ? 0 : 3 + Math.floor(Math.random() * 5) + i + delay
    );
    if (spins.every((n) => n === 0)) return;

    const timer = setInterval(() => {
      let stillSpinning = false;
      const next = [...shownRef.current];
      const bumped = [];

      spins.forEach((n, i) => {
        if (n <= 0) return;
        spins[i] = n - 1;
        // Last spin lands on the real letter; before that, random letters
        next[i] = spins[i] === 0 ? target[i] : CHARSET[Math.floor(Math.random() * CHARSET.length)];
        bumped.push(i);
        if (spins[i] > 0) stillSpinning = true;
      });

      setShown(next.join(""));
      setFlips((f) => f.map((v, i) => (bumped.includes(i) ? v + 1 : v)));
      if (!stillSpinning) clearInterval(timer);
    }, TICK_MS);

    return () => clearInterval(timer);
  }, [target, delay]);

  return (
    <span className="flaps" data-tone={tone} aria-label={String(text)} role="text">
      {[...shown].map((ch, i) => (
        <span className="flap" key={i} aria-hidden="true">
          <span className="flap-ch" key={flips[i]}>
            {ch === " " ? " " : ch}
          </span>
        </span>
      ))}
    </span>
  );
}
