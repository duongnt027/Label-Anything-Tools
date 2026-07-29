import { useCallback, useEffect, useState } from "react";
import { api } from "../api";

type MountDirEntry = {
  name: string;
  path: string;
  has_children: boolean;
  image_count: number;
};

type MountTreeOut = {
  path: string;
  parent: string | null;
  entries: MountDirEntry[];
};

type Props = {
  value: string;
  onChange: (path: string) => void;
  disabled?: boolean;
};

export function MountFolderTree({ value, onChange, disabled = false }: Props) {
  const [childrenByPath, setChildrenByPath] = useState<Record<string, MountDirEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [loadingPath, setLoadingPath] = useState<string | null>(null);
  const [error, setError] = useState("");

  const fetchTree = useCallback(async (path: string) => {
    const q = path ? `?path=${encodeURIComponent(path)}` : "";
    return api<MountTreeOut>(`/api/tasks/mount-tree${q}`);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError("");

    const expandBranch = async (entries: MountDirEntry[], depth: number, expandedPaths: Set<string>) => {
      if (depth >= 2 || cancelled) return;
      const entry = entries.find((e) => e.has_children) ?? entries[0];
      if (!entry?.has_children) return;
      const r = await fetchTree(entry.path);
      if (cancelled) return;
      setChildrenByPath((prev) => ({ ...prev, [entry.path]: r.entries }));
      expandedPaths.add(entry.path);
      setExpanded(new Set(expandedPaths));
      await expandBranch(r.entries, depth + 1, expandedPaths);
    };

    fetchTree("")
      .then(async (r) => {
        if (cancelled) return;
        setChildrenByPath({ "": r.entries });
        const expandedPaths = new Set<string>();
        await expandBranch(r.entries, 0, expandedPaths);
        if (!value && r.entries.length === 1) {
          onChange(r.entries[0].path);
        }
      })
      .catch((ex) => {
        if (!cancelled) setError(ex instanceof Error ? ex.message : "Không tải được cây thư mục");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchTree]);

  const ensureChildren = async (path: string) => {
    if (childrenByPath[path]) return;
    setLoadingPath(path);
    setError("");
    try {
      const r = await fetchTree(path);
      setChildrenByPath((prev) => ({ ...prev, [path]: r.entries }));
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : "Không mở được thư mục");
    } finally {
      setLoadingPath(null);
    }
  };

  const toggleExpand = (entry: MountDirEntry) => {
    if (disabled || !entry.has_children) return;
    const path = entry.path;
    if (expanded.has(path)) {
      setExpanded((prev) => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
      return;
    }
    void ensureChildren(path).then(() => {
      setExpanded((prev) => new Set(prev).add(path));
    });
  };

  const renderLevel = (listKey: string, depth: number) => {
    const entries = childrenByPath[listKey];
    if (!entries) return null;
    return entries.map((entry) => {
      const isOpen = expanded.has(entry.path);
      const isSelected = value === entry.path;
      const isLoading = loadingPath === entry.path;
      return (
        <li key={entry.path} className="mount-tree-node">
          <div
            className={`mount-tree-row ${isSelected ? "selected" : ""}`}
            style={{ paddingLeft: `${0.35 + depth * 0.85}rem` }}
          >
            <button
              type="button"
              className={`mount-tree-chevron ${entry.has_children ? "" : "leaf"}`}
              aria-label={isOpen ? "Thu gọn" : "Mở rộng"}
              disabled={!entry.has_children || isLoading || disabled}
              onClick={() => toggleExpand(entry)}
            >
              {isLoading ? "…" : entry.has_children ? (isOpen ? "▾" : "▸") : "·"}
            </button>
            <button
              type="button"
              className="mount-tree-label"
              disabled={disabled}
              onClick={() => {
                if (!disabled) onChange(entry.path);
              }}
              title={entry.path}
            >
              {entry.name}
              {entry.image_count > 0 && (
                <span className="mount-tree-count">{entry.image_count} ảnh</span>
              )}
            </button>
          </div>
          {isOpen && entry.has_children && (
            <ul className="mount-tree-children">{renderLevel(entry.path, depth + 1)}</ul>
          )}
        </li>
      );
    });
  };

  return (
    <div className={`mount-tree ${disabled ? "is-disabled" : ""}`}>
      <div className="create-task-scroll-shell mount-tree-shell">
        <div className="mount-tree-panel pretty-scroll">
          {error && <p className="form-error mount-tree-error">{error}</p>}
          {!childrenByPath[""] && !error && <p className="anno-muted mount-tree-loading">Đang tải...</p>}
          {childrenByPath[""]?.length === 0 && !error && (
            <p className="anno-muted">Không có thư mục mount (vd: sample_images).</p>
          )}
          <ul className="mount-tree-root">{renderLevel("", 0)}</ul>
        </div>
      </div>
    </div>
  );
}
