// Trophy cabinet: unlocked ones glow, locked ones show how to get them.
import { trophies } from "../utils/game.js";

export default function Trophies({ progress, subjects }) {
  const list = trophies(progress, subjects);
  const got = list.filter((t) => t.got).length;

  return (
    <div>
      <p className="muted trophy-count">
        {got} of {list.length} unlocked
      </p>
      <ul className="trophies">
        {list.map((t) => (
          <li key={t.id} className={`trophy ${t.got ? "is-got" : ""}`}>
            <span className="trophy-icon" aria-hidden="true">
              <TrophyShape />
            </span>
            <span className="trophy-name">{t.name}</span>
            <span className="trophy-how">{t.got ? "Unlocked" : t.how}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// A small pixel-art cup drawn with squares (SVG), so no emoji or images needed
function TrophyShape() {
  const px = [
    "0111110",
    "1111111",
    "1111111",
    "0111110",
    "0011100",
    "0001000",
    "0011100",
    "0111110",
  ];
  return (
    <svg viewBox="0 0 7 8" width="28" height="32" shapeRendering="crispEdges">
      {px.flatMap((row, y) =>
        [...row].map((c, x) => (c === "1" ? <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="currentColor" /> : null))
      )}
    </svg>
  );
}
