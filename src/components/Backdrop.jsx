// The animated night sky behind the whole app: slow aurora glows
// (lime / cyan / pink, the game's colours) and a field of twinkling pixel stars.
// It sits behind everything (z-index -1) and pauses when the tab is hidden.
// People who turn on "reduce motion" get a still sky.
import { useEffect, useRef } from "react";

const STAR_COLORS = ["#f3f0ff", "#f3f0ff", "#f3f0ff", "#47e0ff", "#b8ff3c", "#ffd447"];

export default function Backdrop() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let stars = [];
    let frame = 0;
    let raf = 0;

    function resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // About one star per 9000 square pixels: a full sky on desktop, not too busy on phones
      const count = Math.round((window.innerWidth * window.innerHeight) / 9000);
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        size: Math.random() < 0.85 ? 1 : 2,
        color: STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)],
        speed: 0.01 + Math.random() * 0.03,
        phase: Math.random() * Math.PI * 2,
        drift: 0.02 + Math.random() * 0.06,
      }));
      draw();
    }

    function draw() {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      stars.forEach((s) => {
        // Twinkle: brightness goes up and down on a slow sine wave
        ctx.globalAlpha = 0.25 + 0.6 * (0.5 + 0.5 * Math.sin(s.phase + frame * s.speed));
        ctx.fillStyle = s.color;
        // Whole pixels keep the stars crisp, like an arcade screen
        ctx.fillRect(Math.round(s.x), Math.round((s.y - frame * s.drift + window.innerHeight * 10) % window.innerHeight), s.size, s.size);
      });
      ctx.globalAlpha = 1;
    }

    function loop() {
      frame += 1;
      draw();
      raf = requestAnimationFrame(loop);
    }

    function onVisibility() {
      cancelAnimationFrame(raf);
      if (!document.hidden && !still) raf = requestAnimationFrame(loop);
    }

    resize();
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVisibility);
    if (!still) raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <div className="backdrop" aria-hidden="true">
      <span className="aurora aurora-1" />
      <span className="aurora aurora-2" />
      <span className="aurora aurora-3" />
      <canvas ref={canvasRef} className="stars" />
      <span className="horizon" />
    </div>
  );
}
