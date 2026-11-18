// Trophy cabinet: unlocked ones glow, locked ones show how to get them.
import { TROPHY_GROUPS, trophies } from "../utils/game.js";

export default function Trophies({ progress, subjects }) {
  const list = trophies(progress, subjects);
  const got = list.filter((t) => t.got).length;

  return (
    <div>
      <p className="muted trophy-count">
        {got} of {list.length} unlocked
      </p>
      {TROPHY_GROUPS.map((group) => {
        const items = list.filter((t) => t.group === group);
        if (!items.length) return null;
        return (
          <section key={group} className="trophy-group">
            <h3 className="trophy-group-title">
              {group} <span className="muted">{items.filter((t) => t.got).length}/{items.length}</span>
            </h3>
            <ul className="trophies">
              {items.map((t) => (
                <li key={t.id} className={`trophy ${t.got ? "is-got" : ""}`} title={t.how}>
                  <span className="trophy-icon" aria-hidden="true">
                    <TrophyShape />
                  </span>
                  <span className="trophy-name">{t.name}</span>
                  <span className="trophy-how">{t.got ? "Unlocked" : t.how}</span>
                  {!t.got && t.progress && (
                    <span className="trophy-bar" aria-label={`${t.progress[0]} of ${t.progress[1]}`}>
                      <i style={{ width: `${(t.progress[0] / t.progress[1]) * 100}%` }} />
                      <b>
                        {t.progress[0]}/{t.progress[1]}
                      </b>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
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
