import { KeyboardEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { classColorForName } from "../utils/classColors";

type MenuPos = { left: number; width: number; bottom: number; maxHeight: number };

const PICKER_ROW_PX = 28;
const PICKER_VISIBLE_ROWS = 3;

export function ClassCombobox({
  classes,
  value,
  disabled,
  placeholder,
  onChange,
  onCommitNew,
  classIndex,
}: {
  classes: string[];
  value: string;
  disabled?: boolean;
  placeholder?: string;
  onChange: (className: string) => void;
  onCommitNew: (className: string) => void | Promise<void>;
  classIndex: Map<string, number>;
}) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [menuPos, setMenuPos] = useState<MenuPos | null>(null);
  const [pickerPos, setPickerPos] = useState<MenuPos | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const pickerRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return classes;
    return classes.filter((c) => c.toLowerCase().includes(q));
  }, [classes, query]);

  const exact = useMemo(
    () => classes.find((c) => c.toLowerCase() === query.trim().toLowerCase()),
    [classes, query],
  );

  const isNew =
    query.trim().length > 0 && !classes.some((c) => c.toLowerCase() === query.trim().toLowerCase());

  const updateMenuPos = (maxHeight: number) => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const gap = 4;
    const height = Math.min(maxHeight, Math.max(80, r.top - gap - 8));
    return {
      left: r.left,
      width: Math.max(r.width, 140),
      bottom: window.innerHeight - r.top + gap,
      maxHeight: height,
    };
  };

  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    const pos = updateMenuPos(180);
    if (pos) setMenuPos(pos);
    const onScroll = () => {
      const p = updateMenuPos(180);
      if (p) setMenuPos(p);
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, matches.length, isNew]);

  useLayoutEffect(() => {
    if (!pickerOpen) {
      setPickerPos(null);
      return;
    }
    const maxH = PICKER_ROW_PX * PICKER_VISIBLE_ROWS + 8;
    const pos = updateMenuPos(maxH);
    if (pos) setPickerPos({ ...pos, maxHeight: maxH });
    const onScroll = () => {
      const p = updateMenuPos(maxH);
      if (p) setPickerPos({ ...p, maxHeight: maxH });
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [pickerOpen, classes.length]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || listRef.current?.contains(t) || pickerRef.current?.contains(t)) {
        return;
      }
      setOpen(false);
      setPickerOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    setHi(0);
  }, [query, open]);

  const pick = (name: string) => {
    setQuery(name);
    setOpen(false);
    setPickerOpen(false);
    onChange(name);
  };

  const commitEnter = async () => {
    const raw = query.trim();
    if (!raw) return;
    if (exact) {
      pick(exact);
      return;
    }
    setOpen(false);
    await onCommitNew(raw);
    setQuery(raw);
    onChange(raw);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setPickerOpen(false);
      setHi((i) => Math.min(i + 1, Math.max(matches.length + (isNew ? 1 : 0) - 1, 0)));
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
      if (open && isNew && hi === matches.length) {
        void commitEnter();
        return;
      }
      void commitEnter();
      return;
    }
    if (e.key === "Escape") {
      setOpen(false);
      setPickerOpen(false);
    }
  };

  const colorOf = (cls: string) => classColorForName(cls, classIndex);

  const filterMenu =
    open && menuPos && !disabled && !pickerOpen ? (
      <ul
        ref={listRef}
        className="class-combo-menu class-combo-menu-up pretty-scroll"
        style={{
          left: menuPos.left,
          width: menuPos.width,
          bottom: menuPos.bottom,
          maxHeight: menuPos.maxHeight,
        }}
      >
        {matches.map((c, i) => {
          const col = colorOf(c);
          return (
            <li key={c}>
              <button
                type="button"
                className={`class-picker-option ${i === hi ? "hi" : ""}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(c)}
              >
                <span className="class-picker-dot" style={{ background: col }} aria-hidden />
                <span className="class-picker-name" style={{ color: col }}>
                  {c}
                </span>
              </button>
            </li>
          );
        })}
        {isNew && (
          <li>
            <button
              type="button"
              className={`class-picker-option class-picker-new ${hi === matches.length ? "hi" : ""}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void commitEnter()}
            >
              + Thêm &quot;{query.trim()}&quot;
            </button>
          </li>
        )}
        {matches.length === 0 && !isNew && <li className="class-combo-empty">Không có class</li>}
      </ul>
    ) : null;

  const pickerMenu =
    pickerOpen && pickerPos && !disabled ? (
      <ul
        ref={pickerRef}
        className="class-picker-menu class-combo-menu-up pretty-scroll"
        style={{
          left: pickerPos.left,
          width: pickerPos.width,
          bottom: pickerPos.bottom,
          maxHeight: pickerPos.maxHeight,
        }}
      >
        {classes.map((c) => {
          const col = colorOf(c);
          return (
            <li key={c}>
              <button
                type="button"
                className="class-picker-option"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(c)}
              >
                <span className="class-picker-dot" style={{ background: col }} aria-hidden />
                <span className="class-picker-name" style={{ color: col }}>
                  {c}
                </span>
              </button>
            </li>
          );
        })}
        {classes.length === 0 && <li className="class-combo-empty">Không có class</li>}
      </ul>
    ) : null;

  return (
    <div className="class-combo" ref={wrapRef}>
      <div className="class-combo-field">
        <input
          ref={inputRef}
          className="class-combo-input anno-oneline-input pretty-scroll"
          lang="vi"
          value={query}
          disabled={disabled}
          placeholder={placeholder}
          autoComplete="off"
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setPickerOpen(false);
          }}
          onFocus={() => {
            setOpen(true);
            setPickerOpen(false);
          }}
          onKeyDown={onKeyDown}
        />
        {!disabled && (
          <button
            type="button"
            className="btn-x class-combo-picker-btn"
            title="Chọn class khác"
            onClick={() => {
              setPickerOpen((v) => !v);
              setOpen(false);
            }}
          >
            ×
          </button>
        )}
      </div>
      {filterMenu && createPortal(filterMenu, document.body)}
      {pickerMenu && createPortal(pickerMenu, document.body)}
    </div>
  );
}
