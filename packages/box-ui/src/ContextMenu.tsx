// SPDX-License-Identifier: LicenseRef-Proprietary
// ContextMenu - the right-click surface for canvas + nodes. Fixed-position
// overlay (client coords), edge-clamped, closes on click-away/Escape.
// Items are declared by the platform; the menu itself is dumb.

import { useEffect, useRef } from "react";
import { Icon, type IconName } from "./icons.js";

export interface MenuItem {
  label: string;
  icon?: IconName;
  danger?: boolean;
  disabled?: boolean;
  hint?: string;
  onPick: () => void;
}

export interface MenuSpec {
  /** Client (CSS pixel) position of the menu's top-left corner. */
  x: number;
  y: number;
  items: MenuItem[];
}

export function ContextMenu(props: { menu: MenuSpec; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  // Close on Escape, outside pointer, scroll, or window blur.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        props.onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("blur", props.onClose);
    window.addEventListener("wheel", props.onClose, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("blur", props.onClose);
      window.removeEventListener("wheel", props.onClose, true);
    };
  }, [props.onClose]);

  // Clamp to viewport so the menu never opens off-screen.
  const m = ref.current;
  let x = props.menu.x;
  let y = props.menu.y;
  if (m) {
    const r = m.getBoundingClientRect();
    x = Math.min(x, window.innerWidth - r.width - 8);
    y = Math.min(y, window.innerHeight - r.height - 8);
  }

  return (
    <div ref={ref} className="ctx-menu" style={{ left: x, top: y }}>
      {props.menu.items.map((it, i) => (
        <button
          key={i}
          className={
            "ctx-item" +
            (it.danger ? " danger" : "") +
            (it.disabled ? " disabled" : "")
          }
          disabled={it.disabled}
          onClick={() => {
            props.onClose();
            it.onPick();
          }}
        >
          {it.icon && <Icon name={it.icon} size={14} />}
          <span className="ctx-label">{it.label}</span>
          {it.hint && <span className="ctx-hint">{it.hint}</span>}
        </button>
      ))}
    </div>
  );
}
