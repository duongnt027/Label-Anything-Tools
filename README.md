# Hệ thống gán nhãn & review — Label Anything

## Yêu cầu

- Docker & Docker Compose
- Conda env `label_anything` (Python 3.11)

## Chạy bằng Docker (khuyến nghị)

```bash
cd /home/duongnt/codes/label_anything
docker compose up --build
```

- Web UI: http://localhost:8080  
- API: http://localhost:8001/api/health  
- PostgreSQL host: `localhost:5433`

Ảnh mẫu: mount thư mục `./sample_images` vào `STORAGE_ROOT/sample_images`. Khi tạo task, điền folder `sample_images`.

## Conda (dev local)

```bash
conda env create -f environment.yml
conda activate label_anything
```

Chạy DB (docker):

```bash
docker compose up db -d
```

Sửa `.env` cho local:

```
DATABASE_URL=postgresql+psycopg2://label_anything:label_anything_secret@localhost:5432/label_anything
STORAGE_ROOT=./storage
```

Backend:

```bash
cd backend
uvicorn app.main:app --reload --port 8000
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

## Tài khoản seed

| username   | password | role      |
|-----------|----------|-----------|
| admin     | 1        | admin     |
| annotator1| 1        | annotator |
| reviewer1 | 1        | reviewer  |

## Biến môi trường (`.env`)

| Biến | Mô tả |
|------|--------|
| `POSTGRES_*` | PostgreSQL |
| `DATABASE_URL` | SQLAlchemy URL |
| `SECRET_KEY` | JWT |
| `STORAGE_ROOT` | Volume ảnh (path DB là relative) |
| `JOB_LOCK_TIMEOUT_MINUTES` | Idle timeout (minutes) while inside a job before auto-unlock; leaving unlocks immediately (30) |
| `TZ` | Asia/Ho_Chi_Minh |

Spec chi tiết: `component.md`, `ui.md`.
