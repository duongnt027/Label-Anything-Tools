export function isZipFile(f: File) {
  const n = (f.name || "").toLowerCase();
  if (n.endsWith(".zip")) return true;
  const t = (f.type || "").toLowerCase();
  return (
    t === "application/zip" ||
    t === "application/x-zip-compressed" ||
    t === "application/x-zip" ||
    t === "application/x-compressed" ||
    (t === "application/octet-stream" && n.endsWith(".zip"))
  );
}

export function pickZipFromDataTransfer(dt: DataTransfer | null): File | null {
  if (!dt) return null;
  if (dt.files?.length) {
    for (let i = 0; i < dt.files.length; i++) {
      const f = dt.files[i];
      if (isZipFile(f)) return f;
    }
  }
  if (dt.items?.length) {
    for (let i = 0; i < dt.items.length; i++) {
      const item = dt.items[i];
      if (item.kind !== "file") continue;
      const f = item.getAsFile();
      if (f && isZipFile(f)) return f;
    }
  }
  return null;
}

export function dataTransferHasFiles(dt: DataTransfer | null) {
  if (!dt?.types?.length) return true;
  return dt.types.some(
    (t) => t === "Files" || t === "application/x-moz-file" || t === "public.file-url",
  );
}

export function isImportTaskFile(f: File) {
  const n = (f.name || "").toLowerCase();
  if (n.endsWith(".json") || n.endsWith(".zip")) return true;
  if (isZipFile(f)) return true;
  const t = (f.type || "").toLowerCase();
  return t === "application/json" || t.endsWith("+json");
}

export function pickImportTaskFileFromDataTransfer(dt: DataTransfer | null): File | null {
  if (!dt) return null;
  if (dt.files?.length) {
    for (let i = 0; i < dt.files.length; i++) {
      const f = dt.files[i];
      if (isImportTaskFile(f)) return f;
    }
  }
  if (dt.items?.length) {
    for (let i = 0; i < dt.items.length; i++) {
      const item = dt.items[i];
      if (item.kind !== "file") continue;
      const f = item.getAsFile();
      if (f && isImportTaskFile(f)) return f;
    }
  }
  return null;
}
