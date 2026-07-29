import io
import json
import os
import random
import re
import shutil
import uuid
import zipfile
from pathlib import Path

from sqlalchemy.orm import Session

from app.config import settings
from app.models import Box, Image, Job, JobState, LogAction, LogTargetType, Task, User, UserRole
from app.services.jobs import count_job_images, task_stats, touch_job_lock, write_log
from app.services.status import derive_image_status


def storage_path(*parts: str | int | Path) -> Path:
    return Path(settings.storage_root).joinpath(*(str(p) for p in parts))


def ensure_storage() -> None:
    storage_path().mkdir(parents=True, exist_ok=True)


def resolve_mount_dir(rel: str) -> Path:
    """Resolve a path relative to storage root; block traversal."""
    root = storage_path().resolve()
    clean = (rel or "").strip().strip("/")
    if not clean:
        return root
    target = storage_path(*clean.split("/")).resolve()
    if target != root and root not in target.parents:
        raise ValueError("invalid mount path")
    if not target.is_dir():
        raise FileNotFoundError(clean)
    return target


def count_images_in_dir(folder: Path) -> int:
    if not folder.is_dir():
        return 0
    n = 0
    for p in folder.iterdir():
        if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS:
            n += 1
    return n


def mount_tree(rel: str) -> tuple[str, str | None, list[dict]]:
    root = storage_path().resolve()
    clean = (rel or "").strip().strip("/")

    if not clean:
        entries = []
        for p in sorted(root.iterdir(), key=lambda x: x.name.lower()):
            if not p.is_dir() or p.name in MOUNT_BROWSE_SKIP or p.name.startswith("."):
                continue
            rel_path = p.name
            subdirs = [c for c in p.iterdir() if c.is_dir() and not c.name.startswith(".")]
            entries.append(
                {
                    "name": p.name,
                    "path": rel_path,
                    "has_children": len(subdirs) > 0,
                    "image_count": count_images_in_dir(p),
                }
            )
        return "", None, entries

    folder = resolve_mount_dir(clean)
    parent_rel = None
    if folder != root:
        parent = folder.parent
        if parent == root:
            parent_rel = ""
        elif root in parent.parents or parent == root:
            parent_rel = str(parent.relative_to(root)).replace("\\", "/")

    entries = []
    for p in sorted(folder.iterdir(), key=lambda x: x.name.lower()):
        if not p.is_dir() or p.name.startswith("."):
            continue
        rel_path = str(p.relative_to(root)).replace("\\", "/")
        subdirs = [c for c in p.iterdir() if c.is_dir() and not c.name.startswith(".")]
        entries.append(
            {
                "name": p.name,
                "path": rel_path,
                "has_children": len(subdirs) > 0,
                "image_count": count_images_in_dir(p),
            }
        )
    return clean, parent_rel, entries


ROLE_RANK = {"admin": 3, "reviewer": 2, "annotator": 1}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"}
MOUNT_BROWSE_SKIP = frozenset({"tasks", "uploads"})
ZIP_SKIP_PREFIXES = ("__MACOSX/",)
ZIP_SKIP_NAMES = frozenset({".ds_store"})


def list_mount_folder_images(folder: Path) -> list[tuple[str, str]]:
    """Images directly in folder only; never includes .json or other files."""
    if not folder.is_dir():
        return []
    items: list[tuple[str, str]] = []
    for p in sorted(folder.iterdir(), key=lambda x: x.name.lower()):
        if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS:
            items.append((str(p), p.name))
    return items


def _normalize_zip_entry(name: str) -> str:
    return name.replace("\\", "/").lstrip("./")


def _skip_zip_entry(norm: str) -> bool:
    if not norm:
        return True
    lower = norm.lower()
    if any(lower.startswith(p.lower()) for p in ZIP_SKIP_PREFIXES):
        return True
    base = Path(norm).name.lower()
    return base in ZIP_SKIP_NAMES


def extract_task_zip(content: bytes, user_id: int) -> tuple[list[tuple[str, str]], list[dict] | None]:
    """
    ZIP must contain exactly one top-level folder of images (depth 1 under that folder).
    Optional single .json at zip root or inside that folder — classes and bboxes (match by filename).
    """
    ensure_storage()
    batch_dir = storage_path("uploads", str(user_id), uuid.uuid4().hex)
    batch_dir.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(io.BytesIO(content)) as zf:
        file_entries: list[tuple[str, zipfile.ZipInfo]] = []
        for info in zf.infolist():
            if info.is_dir() or info.filename.endswith("/"):
                continue
            norm = _normalize_zip_entry(info.filename)
            if _skip_zip_entry(norm):
                continue
            file_entries.append((norm, info))

        root_dirs: set[str] = set()
        root_level_files: list[tuple[str, zipfile.ZipInfo]] = []
        for norm, info in file_entries:
            if "/" not in norm:
                root_level_files.append((norm, info))
            else:
                root_dirs.add(norm.split("/")[0])

        if len(root_dirs) != 1:
            raise ValueError("ZIP phải chứa đúng một thư mục chứa ảnh")

        root_json: list[tuple[str, zipfile.ZipInfo]] = []
        for norm, info in root_level_files:
            if Path(norm).suffix.lower() == ".json":
                root_json.append((norm, info))
            else:
                raise ValueError(
                    "File ở gốc ZIP chỉ được là JSON nhãn (vd: annos.json); ảnh nằm trong một thư mục"
                )

        root = next(iter(root_dirs))
        prefix = f"{root}/"
        images: list[tuple[str, zipfile.ZipInfo]] = []
        folder_json: list[tuple[str, zipfile.ZipInfo]] = []

        for norm, info in file_entries:
            if not norm.startswith(prefix):
                continue
            rel = norm[len(prefix) :]
            if not rel or "/" in rel:
                continue
            ext = Path(rel).suffix.lower()
            if ext in IMAGE_EXTENSIONS:
                images.append((rel, info))
            elif ext == ".json":
                folder_json.append((rel, info))

        if not images:
            raise ValueError("Thư mục trong ZIP không có ảnh (cấp con trực tiếp)")

        json_entries = root_json + folder_json
        if len(json_entries) > 1:
            raise ValueError("ZIP chỉ được có tối đa một file JSON")

        annotation_items: list[dict] | None = None
        if len(json_entries) == 1:
            raw = zf.read(json_entries[0][1])
            data = json.loads(raw.decode("utf-8"))
            annotation_items = normalize_annotation_items(data)

        sources: list[tuple[str, str]] = []
        for rel, info in sorted(images, key=lambda x: x[0].lower()):
            stored = _unique_name(batch_dir, Path(rel).name)
            dest = batch_dir / stored
            dest.write_bytes(zf.read(info))
            sources.append((str(dest), stored))

    return sources, annotation_items


def _safe_basename(name: str) -> str:
    base = Path(name).name
    base = re.sub(r"[^\w.\- ]+", "_", base).strip()
    return base or "image.jpg"


def _unique_name(dest_dir: Path, filename: str) -> str:
    candidate = _safe_basename(filename)
    if not (dest_dir / candidate).exists():
        return candidate
    stem = Path(candidate).stem
    ext = Path(candidate).suffix or ".jpg"
    n = 2
    while (dest_dir / f"{stem}_{n}{ext}").exists():
        n += 1
    return f"{stem}_{n}{ext}"


def _golden_pool_taken_names(db: Session, task_id: int, golden_dir: Path) -> set[str]:
    taken: set[str] = set()
    if golden_dir.is_dir():
        for p in golden_dir.iterdir():
            if p.is_file():
                taken.add(p.name.lower())
    rows = (
        db.query(Image)
        .filter(Image.task_id == task_id, Image.job_id.is_(None), Image.is_golden.is_(True))
        .all()
    )
    for img in rows:
        taken.add(Path(img.image_source).name.lower())
    return taken


def _golden_pool_unique_basename(
    taken: set[str],
    filename: str,
) -> tuple[str, bool]:
    """Return stored basename; use stem-0, stem-1, … when name already in pool."""
    candidate = _safe_basename(filename)
    if candidate.lower() not in taken:
        return candidate, False
    stem = Path(candidate).stem
    ext = Path(candidate).suffix or ".jpg"
    n = 0
    while True:
        name = f"{stem}-{n}{ext}"
        if name.lower() not in taken:
            return name, True
        n += 1


def _rewrite_annotation_paths_for_renames(items: list[dict], rename_map: dict[str, str]) -> None:
    """Update path fields when imported images were renamed (basename keys are lowercase)."""
    if not rename_map:
        return
    for item in items:
        for field in ("path", "image_filename", "filename", "file", "image"):
            val = item.get(field)
            if not val:
                continue
            raw = str(val).replace("\\", "/")
            base = Path(raw).name
            new_base = rename_map.get(base.lower())
            if not new_base:
                continue
            if "/" in raw:
                item[field] = str(Path(raw).parent / new_base).replace("\\", "/")
            else:
                item[field] = new_base


async def materialize_uploads(files: list, user_id: int) -> list[tuple[str, str]]:
    ensure_storage()
    batch_dir = storage_path("uploads", str(user_id), uuid.uuid4().hex)
    batch_dir.mkdir(parents=True, exist_ok=True)
    items: list[tuple[str, str]] = []

    for f in files:
        raw_name = f.filename or "image.jpg"
        content = await f.read()
        if raw_name.lower().endswith(".zip"):
            with zipfile.ZipFile(io.BytesIO(content)) as zf:
                for info in zf.infolist():
                    if info.is_dir():
                        continue
                    ext = Path(info.filename).suffix.lower()
                    if ext not in IMAGE_EXTENSIONS:
                        continue
                    name = _unique_name(batch_dir, info.filename)
                    dest = batch_dir / name
                    dest.write_bytes(zf.read(info))
                    items.append((str(dest), name))
        else:
            ext = Path(raw_name).suffix.lower()
            if ext not in IMAGE_EXTENSIONS:
                continue
            name = _unique_name(batch_dir, raw_name)
            dest = batch_dir / name
            dest.write_bytes(content)
            items.append((str(dest), name))

    items.sort(key=lambda x: x[1].lower())
    return items


def image_source_rel_from_abs(abs_path: Path) -> str:
    """Relative path under STORAGE_ROOT for an existing file (no copy)."""
    root = storage_path().resolve()
    resolved = abs_path.resolve()
    if resolved != root and root not in resolved.parents:
        raise ValueError("image path outside storage root")
    if not resolved.is_file():
        raise FileNotFoundError(str(resolved))
    return str(resolved.relative_to(root)).replace("\\", "/")


def bbox_dict_to_box_points(b: dict) -> str:
    """Import: x_center, y_center, w, h (normalized). Legacy x,y + coord still supported."""
    w = float(b.get("w", 0) or 0)
    h = float(b.get("h", 0) or 0)
    if "x_center" in b or "y_center" in b:
        xc = float(b.get("x_center", 0) or 0)
        yc = float(b.get("y_center", 0) or 0)
    else:
        x = float(b.get("x", 0) or 0)
        y = float(b.get("y", 0) or 0)
        coord = (b.get("coord") or b.get("box_coord") or "").lower()
        if coord in ("xywh_top_left", "top_left"):
            xc = x + w / 2.0
            yc = y + h / 2.0
        else:
            xc, yc = x, y
    return f"{xc} {yc} {w} {h}"


def _export_bbox_from_box(box: Box, visibility: str) -> dict | None:
    visible = box.status.value != "Rejected"
    if visibility == "visible" and not visible:
        return None
    if visibility == "invisible" and visible:
        return None
    parts = box.box_points.split()
    xc, yc, w, h = (float(p) for p in (parts + ["0", "0", "0", "0"])[:4])
    seg: list[float] = []
    if box.segment_points.strip():
        seg = [float(v) for v in box.segment_points.split()]
    return {
        "id": box.id,
        "x_center": xc,
        "y_center": yc,
        "w": w,
        "h": h,
        "caption": box.caption,
        "ocr": box.ocr_text,
        "class": box.class_,
        "segment": seg,
        "visible": visible,
    }


def build_annotation_zip(rows: list[tuple[dict, Path]], include_images: bool) -> bytes:
    """annos.json at zip root; optional images/ sibling folder."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        annos = [entry for entry, _ in rows]
        zf.writestr("annos.json", json.dumps(annos, ensure_ascii=False, indent=2))
        if include_images:
            seen: set[str] = set()
            for _entry, fp in rows:
                if not fp.is_file():
                    continue
                name = fp.name
                if name in seen:
                    continue
                seen.add(name)
                zf.write(fp, f"images/{name}")
    return buf.getvalue()


def parse_annos_upload(content: bytes, filename: str) -> list[dict]:
    name = (filename or "").lower()
    if name.endswith(".zip"):
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            annos_name: str | None = None
            for info in zf.infolist():
                if info.is_dir():
                    continue
                norm = _normalize_zip_entry(info.filename)
                if Path(norm).name != "annos.json":
                    continue
                if norm == "annos.json":
                    annos_name = info.filename
                    break
                if annos_name is None:
                    annos_name = info.filename
            if not annos_name:
                raise ValueError("ZIP không có annos.json")
            data = json.loads(zf.read(annos_name).decode("utf-8"))
    else:
        data = json.loads(content.decode("utf-8"))
    return normalize_annotation_items(data)


def normalize_annotation_items(data) -> list[dict]:
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("images", "items", "annotations", "data"):
            inner = data.get(key)
            if isinstance(inner, list):
                return inner
        if any(k in data for k in ("path", "image_filename", "filename", "bboxes", "boxes")):
            return [data]
    raise ValueError("annos.json không hợp lệ")


def _annotation_basename_keys(name: str) -> list[str]:
    base = Path(str(name).replace("\\", "/")).name.lower()
    return [base] if base else []


def _annotation_item_lookup_keys(item: dict) -> list[str]:
    keys: list[str] = []
    for field in ("path", "image_filename", "filename", "file", "image"):
        val = item.get(field)
        if val:
            keys.extend(_annotation_basename_keys(str(val)))
    return keys


def _bboxes_from_annotation_item(item: dict) -> list:
    raw = item.get("bboxes")
    if raw is None:
        raw = item.get("boxes")
    if raw is None:
        return []
    return raw if isinstance(raw, list) else []


def link_mount_images_to_task(
    db: Session,
    task: Task,
    sources: list[tuple[str, str]],
    modifier_id: int,
    chunk_size: int,
) -> None:
    """Create jobs/images pointing at existing files under STORAGE_ROOT (no copy)."""
    chunks: list[list[tuple[str, str]]] = []
    for i in range(0, len(sources), chunk_size):
        chunks.append(sources[i : i + chunk_size])

    for chunk in chunks:
        job = Job(
            task_id=task.id,
            state=JobState.new,
            assignee_id=None,
            modifier_id=modifier_id,
        )
        db.add(job)
        db.flush()

        for order_idx, (src, _original_name) in enumerate(chunk):
            rel = image_source_rel_from_abs(Path(src))
            db.add(
                Image(
                    task_id=task.id,
                    job_id=job.id,
                    image_source=rel,
                    order_index=order_idx,
                    modifier_id=modifier_id,
                )
            )


def copy_images_to_task(
    db: Session,
    task: Task,
    sources: list[tuple[str, str]],
    modifier_id: int,
    chunk_size: int,
) -> None:
    ensure_storage()
    storage_path("tasks", str(task.id)).mkdir(parents=True, exist_ok=True)

    chunks: list[list[tuple[str, str]]] = []
    for i in range(0, len(sources), chunk_size):
        chunks.append(sources[i : i + chunk_size])

    for chunk in chunks:
        job = Job(
            task_id=task.id,
            state=JobState.new,
            assignee_id=None,
            modifier_id=modifier_id,
        )
        db.add(job)
        db.flush()
        job_dir = storage_path("tasks", str(task.id), "jobs", str(job.id))
        job_dir.mkdir(parents=True, exist_ok=True)

        for order_idx, (src, original_name) in enumerate(chunk):
            src_path = Path(src)
            if not src_path.is_file():
                raise FileNotFoundError(src)
            stored_name = _unique_name(job_dir, original_name)
            rel = f"tasks/{task.id}/jobs/{job.id}/{stored_name}"
            dest = storage_path(rel)
            shutil.copy2(src_path, dest)
            db.add(
                Image(
                    task_id=task.id,
                    job_id=job.id,
                    image_source=rel,
                    order_index=order_idx,
                    modifier_id=modifier_id,
                )
            )


def copy_images_to_golden_pool(
    db: Session,
    task: Task,
    sources: list[tuple[str, str]],
    modifier_id: int,
) -> tuple[int, dict[str, Image], dict[str, str]]:
    """Copy source images into the task golden pool (job_id=None, is_golden=True).

    Returns count, lookup (stored basenames → Image), and rename_map (lowercase source
    basename → stored basename) for annos.json when names collided with existing pool.
    """
    ensure_storage()
    golden_dir = storage_path("tasks", str(task.id), "golden")
    golden_dir.mkdir(parents=True, exist_ok=True)
    count = 0
    lookup: dict[str, Image] = {}
    rename_map: dict[str, str] = {}
    taken = _golden_pool_taken_names(db, task.id, golden_dir)

    for src, original_name in sources:
        src_path = Path(src)
        if not src_path.is_file():
            continue
        source_base = Path(original_name).name
        stored_name, renamed = _golden_pool_unique_basename(taken, source_base)
        taken.add(stored_name.lower())
        if renamed:
            rename_map[source_base.lower()] = stored_name

        rel = f"tasks/{task.id}/golden/{stored_name}"
        dest = storage_path(rel)
        shutil.copy2(src_path, dest)
        img = Image(
            task_id=task.id,
            job_id=None,
            is_golden=True,
            image_source=rel,
            modifier_id=modifier_id,
        )
        db.add(img)
        db.flush()
        for key in _annotation_basename_keys(stored_name):
            lookup[key] = img
        count += 1
    return count, lookup, rename_map


def inject_golden_images(db: Session, job: Job, modifier_id: int) -> None:
    if job.golden_injected:
        return
    task = db.get(Task, job.task_id)
    if not task or task.golden_per_job <= 0:
        job.golden_injected = True
        return

    pool = (
        db.query(Image)
        .filter(Image.task_id == task.id, Image.job_id.is_(None), Image.is_golden.is_(True))
        .all()
    )
    if not pool:
        job.golden_injected = True
        return

    pick_count = min(task.golden_per_job, len(pool))
    selected = random.sample(pool, pick_count)
    img_num = count_job_images(db, job.id)
    for idx, golden in enumerate(selected):
        rel = golden.image_source
        src = storage_path(rel)
        job_dir = storage_path("tasks", str(task.id), "jobs", str(job.id))
        job_dir.mkdir(parents=True, exist_ok=True)
        stored_name = _unique_name(job_dir, Path(rel).name)
        new_rel = f"tasks/{task.id}/jobs/{job.id}/{stored_name}"
        dest = storage_path(new_rel)
        shutil.copy2(src, dest)
        new_img = Image(
            task_id=task.id,
            job_id=job.id,
            is_golden=True,
            image_source=new_rel,
            order_index=img_num + idx,
            caption=golden.caption,
            details=golden.details,
            tag=list(golden.tag),
            modifier_id=modifier_id,
        )
        db.add(new_img)
        db.flush()
        for box in golden.boxes:
            db.add(
                Box(
                    img_id=new_img.id,
                    is_golden=True,
                    tag=list(box.tag),
                    status=box.status,
                    modifier_id=modifier_id,
                    class_=box.class_,
                    box_points=box.box_points,
                    segment_points=box.segment_points,
                    ocr_text=box.ocr_text,
                    caption=box.caption,
                    details=box.details,
                )
            )
    job.golden_injected = True
    write_log(
        db,
        actor_id=modifier_id,
        action=LogAction.inject_golden_images,
        target_type=LogTargetType.job,
        target_id=job.id,
        detail=f"Injected {pick_count} golden images",
    )


def export_task_zip(
    db: Session,
    task_id: int,
    *,
    box_visibility: str = "all",
    include_images: bool = False,
    include_rejected: bool | None = None,
    job_ids: list[int] | None = None,
) -> tuple[bytes, str]:
    visibility = (box_visibility or "all").lower()
    if include_rejected is not None and box_visibility == "all":
        visibility = "all" if include_rejected else "visible"
    if visibility not in ("all", "visible", "invisible"):
        visibility = "all"

    q = db.query(Image).filter(Image.task_id == task_id, Image.job_id.isnot(None))
    if job_ids:
        q = q.filter(Image.job_id.in_(job_ids))
    images = q.order_by(Image.id).all()
    rows: list[tuple[dict, Path]] = []
    for img in images:
        bboxes = []
        for box in img.boxes:
            bb = _export_bbox_from_box(box, visibility)
            if bb:
                bboxes.append(bb)
        entry: dict = {
            "id": img.id,
            "path": Path(img.image_source).name,
            "caption": img.caption,
            "bboxes": bboxes,
        }
        rows.append((entry, storage_path(img.image_source)))

    if job_ids and len(job_ids) == 1:
        jobs_ordered = (
            db.query(Job).filter(Job.task_id == task_id).order_by(Job.id.asc()).all()
        )
        display = next(
            (i for i, j in enumerate(jobs_ordered, start=1) if j.id == job_ids[0]),
            job_ids[0],
        )
        filename = f"task-{task_id}-job-{display}.zip"
    elif job_ids:
        filename = f"task-{task_id}-jobs-selected.zip"
    else:
        filename = f"task-{task_id}-export.zip"

    return build_annotation_zip(rows, include_images), filename


def export_golden_pool_zip(
    db: Session,
    task_id: int,
    *,
    box_visibility: str = "all",
    include_images: bool = False,
    image_ids: list[int] | None = None,
) -> tuple[bytes, str]:
    visibility = (box_visibility or "all").lower()
    if visibility not in ("all", "visible", "invisible"):
        visibility = "all"

    q = db.query(Image).filter(
        Image.task_id == task_id,
        Image.job_id.is_(None),
        Image.is_golden.is_(True),
    )
    if image_ids:
        q = q.filter(Image.id.in_(image_ids))
    images = q.order_by(Image.id).all()
    rows: list[tuple[dict, Path]] = []
    for img in images:
        bboxes = []
        for box in img.boxes:
            bb = _export_bbox_from_box(box, visibility)
            if bb:
                bboxes.append(bb)
        entry = {
            "id": img.id,
            "path": Path(img.image_source).name,
            "caption": img.caption,
            "bboxes": bboxes,
            "is_golden": True,
        }
        rows.append((entry, storage_path(img.image_source)))

    return build_annotation_zip(rows, include_images), f"task-{task_id}-golden-pool.zip"


def apply_task_json_by_filename(
    db: Session,
    task: Task,
    items: list[dict],
    modifier_id: int,
    *,
    image_lookup: dict[str, Image] | None = None,
) -> int:
    """Apply export-format JSON entries; match images by basename (case-insensitive)."""
    by_name: dict[str, Image] = {}
    if image_lookup:
        by_name.update(image_lookup)
    else:
        images = db.query(Image).filter(Image.task_id == task.id).all()
        for img in images:
            by_name[Path(img.image_source).name.lower()] = img
    class_names: list[str] = list(task.classes or [])
    existing_lower = {c.lower() for c in class_names}
    updated = 0

    for item in items:
        img = None
        for key in _annotation_item_lookup_keys(item):
            img = by_name.get(key)
            if img:
                break
        if not img:
            continue
        if "caption" in item:
            img.caption = item.get("caption")
        img.modifier_id = modifier_id
        for box in list(img.boxes):
            db.delete(box)
        for b in _bboxes_from_annotation_item(item):
            cls = (b.get("class") or "").strip()
            if cls and cls.lower() not in existing_lower:
                class_names.append(cls)
                existing_lower.add(cls.lower())
            db.add(
                Box(
                    img_id=img.id,
                    is_golden=img.is_golden,
                    modifier_id=modifier_id,
                    class_=cls,
                    box_points=bbox_dict_to_box_points(b),
                    segment_points=" ".join(str(v) for v in b.get("segment", [])),
                    ocr_text=b.get("ocr", "") or "",
                    caption=b.get("caption", "") or "",
                )
            )
        updated += 1

    task.classes = class_names
    return updated


def import_task_json(db: Session, task_id: int, items: list[dict], modifier_id: int) -> int:
    task = db.get(Task, task_id)
    if not task:
        return 0
    return apply_task_json_by_filename(db, task, items, modifier_id)


def image_to_dict(img: Image) -> dict:
    return {
        "id": img.id,
        "task_id": img.task_id,
        "job_id": img.job_id,
        "is_golden": img.is_golden,
        "image_source": img.image_source,
        "filename": Path(img.image_source).name,
        "order_index": img.order_index,
        "tag": list(img.tag or []),
        "status": derive_image_status(img.tag or []),
        "caption": img.caption,
        "details": img.details,
    }


def box_to_dict(box: Box) -> dict:
    return {
        "id": box.id,
        "img_id": box.img_id,
        "is_golden": box.is_golden,
        "tag": list(box.tag or []),
        "status": box.status.value,
        "class": box.class_,
        "box_points": box.box_points,
        "segment_points": box.segment_points,
        "ocr_text": box.ocr_text,
        "caption": box.caption,
        "details": box.details,
    }


def can_add_class(user: User, task: Task) -> bool:
    return ROLE_RANK[user.role.value] >= ROLE_RANK[task.min_role_to_add_class.value]
