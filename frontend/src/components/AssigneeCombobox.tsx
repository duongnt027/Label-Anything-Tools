import { KeyboardEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { User } from "../api";

export function AssigneeCombobox({
  users,
  value = "",
  onAssign,
  onClear,
}: {
  users: User[];
  value?: string;
  onAssign: (userId: number) => void;
  onClear?: () => void;
}) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users.slice(0, 8);
    return users.filter((u) => u.username.toLowerCase().includes(q)).slice(0, 8);
  }, [users, query]);

  const exact = useMemo(
    () => users.find((u) => u.username.toLowerCase() === query.trim().toLowerCase()),
    [users, query],
  );

  const updateMenuPos = () => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setMenuPos({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 160) });
  };

  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    updateMenuPos();
    const onScroll = () => updateMenuPos();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || listRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    setHi(0);
  }, [query, open]);

  const pick = (u: User) => {
    setQuery(u.username);
    setOpen(false);
    if (u.username !== value) onAssign(u.id);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHi((i) => Math.min(i + 1, Math.max(matches.length - 1, 0)));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (open && matches[hi]) {
        pick(matches[hi]);
        return;
      }
      if (exact) {
        pick(exact);
        return;
      }
    }
    if (e.key === "Escape") setOpen(false);
  };

  const showClear = Boolean(onClear && value);

  return (
    <div className="assignee-combo" ref={wrapRef}>
      <input
        ref={inputRef}
        className="assignee-combo-input"
        value={query}
        placeholder="Username…"
        autoComplete="off"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {onClear && (
        <button
          type="button"
          className="btn-x"
          title="Bỏ gán assignee"
          hidden={!showClear}
          aria-hidden={!showClear}
          tabIndex={showClear ? 0 : -1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            if (showClear) onClear();
          }}
        >
          ×
        </button>
      )}
      {open && matches.length > 0 && menuPos
        ? createPortal(
            <ul
              ref={listRef}
              className="assignee-combo-list assignee-combo-list-portal pretty-scroll"
              role="listbox"
              style={{ top: menuPos.top, left: menuPos.left, width: menuPos.width }}
            >
              {matches.map((u, i) => (
                <li key={u.id}>
                  <button
                    type="button"
                    className={`assignee-combo-option ${i === hi ? "active" : ""}`}
                    onMouseEnter={() => setHi(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(u)}
                  >
                    <span className="assignee-combo-name">{u.username}</span>
                  </button>
                </li>
              ))}
            </ul>,
            document.body,
          )
        : null}
    </div>
  );
}
