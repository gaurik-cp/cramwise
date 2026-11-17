// The player bar at the top: name, level, XP bar, streak, plus the menu.
import { useEffect, useRef, useState } from "react";
import { levelInfo, streak, totalQuestsDone } from "../utils/game.js";

export default function Hud({ name, progress, menuItems }) {
  const lvl = levelInfo(progress.xp);
  const st = streak(progress);
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  // Close the menu when clicking anywhere else or pressing Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => !menuRef.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <section className="hud">
      <div className="hud-player">
        <span className="avatar" aria-hidden="true">
          {(name || "?").slice(0, 1).toUpperCase()}
        </span>
        <div>
          <p className="hud-name">{name || "Player"}</p>
          <p className="hud-level">Level {lvl.level}</p>
        </div>
      </div>

      <div className="hud-xp">
        <div className="xp-top">
          <span>XP</span>
          <span>
            {lvl.into} / {lvl.needed} to level {lvl.level + 1}
          </span>
        </div>
        <div className="xp-bar" role="progressbar" aria-valuenow={lvl.pct} aria-valuemin={0} aria-valuemax={100}>
          <div style={{ width: `${lvl.pct}%` }} />
        </div>
      </div>

      <div className="hud-stats">
        <div className={`stat ${st > 0 ? "stat-hot" : ""}`}>
          <span className="stat-num">{st}</span>
          <span className="stat-label">day streak</span>
        </div>
        <div className="stat">
          <span className="stat-num">{totalQuestsDone(progress)}</span>
          <span className="stat-label">quests done</span>
        </div>
      </div>

      <div className="menu" ref={menuRef}>
        <button className="btn btn-ghost" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)}>
          Menu
        </button>
        {open && (
          <div className="menu-list" role="menu">
            {menuItems.map((item) =>
              item.divider ? (
                <hr key={item.key} />
              ) : (
                <button
                  key={item.label}
                  role="menuitem"
                  className={item.danger ? "danger" : ""}
                  onClick={() => {
                    setOpen(false);
                    item.onClick();
                  }}
                >
                  {item.label}
                  {item.hint && <small>{item.hint}</small>}
                </button>
              )
            )}
          </div>
        )}
      </div>
    </section>
  );
}
