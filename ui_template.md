# UI Template — Image Captioning

Tài liệu mô tả giao diện người dùng của ứng dụng **Image Captioning** (frontend React/Vite, một file chính `frontend/src/App.jsx`, style `frontend/src/App.css`). App là SPA: sau đăng nhập, nội dung đổi theo `view` và vai trò (`admin` / `reviewer` / `annotator`).

---

## 1. Design system

### 1.1 Chủ đề & màu

Giao diện **dark theme**, font **Inter**.

| Token CSS | Ý nghĩa |
|-----------|---------|
| `--bg-deep` | Nền ngoài cùng |
| `--bg-primary` | Sidebar, topbar, panel phụ |
| `--bg-card` | Thẻ form, nút nền |
| `--bg-hover` | Hover list/button |
| `--text-primary` / `--secondary` / `--muted` | Chữ chính / phụ / mờ |
| `--accent` (#6366f1) | Nút primary, focus, item active |
| `--success` / `--warning` / `--danger` | Completed, lock cảnh báo, xóa/reject |

Bo góc: `--radius-sm` (6px), `--radius` (10px), `--radius-lg` (14px).

### 1.2 Layout shell chung

```
┌─────────────────────────────────────────────────────────────┐
│ app-shell (100vh, overflow hidden)                          │
│ ┌──────────┬──────────────────────────────────────────────┐ │
│ │ sidebar  │ workspace (main)                              │ │
│ │ 260px    │  topbar                                       │ │
│ │ (52px    │  ───────────────────────────────────────────  │ │
│ │ collapsed│  dashboard-panel HOẶC workspace-body annotate │ │
│ │          │                                               │ │
│ │ footer:  │                                               │ │
│ │ Admin,   │                                               │ │
│ │ Sign Out │                                               │ │
│ └──────────┴──────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

- **Sidebar thu gọn**: class `sidebar-collapsed` → cột trái 52px, ẩn chữ, giữ icon.
- Mỗi vùng dài **cuộn riêng** (`overflow-y: auto`), không kéo cao cả trang.

### 1.3 Thành phần UI lặp lại

| Class / pattern | Dùng ở đâu |
|-----------------|------------|
| `topbar-btn` | Nút hành động trên topbar, form inline, footer |
| `topbar-btn primary` | Hành động chính (Login flow, Mở job, Tạo task) |
| `topbar-btn success` / `danger` / `import-btn` | Export, xóa task, import labels |
| `sidebar-btn` + `.active` | Danh sách task/job trong sidebar |
| `user-badge` | Role (ADMIN, REVIEWER, …) |
| `job-state state-*` | Badge trạng thái job |
| `toast` | Thông báo ngắn (góc, sau login hoặc sau thao tác) |
| `admin-overlay` + `admin-modal` | Modal Admin Users, Export |
| `admin-card` / `inline-card` | Form tạo task, import |

---

## 2. Luồng màn hình (views)

| View | Ai thấy | Mục đích |
|------|---------|----------|
| *(chưa token)* **Login** | Mọi người | Đăng nhập |
| `tasks` | Admin | Danh sách task, tạo task/import dataset |
| `task-detail` | Admin | Chi tiết 1 task: đổi tên, jobs, assign, export/import |
| `dashboard` | Annotator / Reviewer (và admin khi không ở task UI) | Jobs được giao |
| `annotate` | Mọi role khi mở job | Workspace gán nhãn ảnh |

Sau login: **admin** → `tasks`; role khác → `dashboard`.

---

## 3. Màn Login

**Layout:** `login-shell` (full viewport, gradient tím nhạt) → `login-card` giữa màn hình.

**Nội dung:**

- Tiêu đề gradient: **Image Captioning**
- Subtitle: *Sign in to start annotation workspace*
- Input: Username, Password
- Nút **Login**
- `toast` nếu có lỗi/thông báo

Không có sidebar; toàn bộ tập trung vào form đăng nhập.

---

## 4. Admin — Quản lý Task

### 4.1 Sidebar

- Header brand: **Admin** + nút thu gọn sidebar
- Dòng user: username + `user-badge` role
- Section **Tasks (N)**: nút từng task + badge số job
- Footer: **Admin Settings**, **Sign Out**

### 4.2 View `tasks` — Quản lý Task

**Topbar:**

- Title: *Quản lý Task*
- Phải: **+ Tạo Task** / **Đóng form**

**Panel chính (`dashboard-panel`):**

1. **Form tạo task** (khi bật): *Tạo Task & Import Dataset*
   - Tab: **Từ mydataset (mount)** | **Upload ZIP**
   - Gợi ý đường dẫn mount host/container
   - Chunk size (ảnh/job), chọn dataset hoặc file ZIP
   - **Tạo & Import** + spinner khi đang import

2. **Bảng danh sách task** (`jobs-table`): Task, Jobs, Cập nhật, nút **Mở**

### 4.3 View `task-detail`

**Topbar:**

- **← Danh sách Task**
- Title task + meta (số job, ngày cập nhật)
- **Import** | **Export** | **Delete Task**

**Panel:**

- Hàng đổi tên task: input + **Lưu tên**
- Form **Import Labels** (JSON/ZIP `annos.json`) khi bật Import
- **Jobs trong task**: toolbar chọn job export, **Filter** (popover Job ID / Assignee / State / Action), bảng jobs
  - Cột: checkbox export, Job, Assignee (select), State, Action, Lock, Cập nhật
  - **Mở** | **Export** từng job

---

## 5. Dashboard — Jobs được giao

Dành cho annotator/reviewer (và layout tương tự khi admin xem dashboard).

**Sidebar:** Jobs được giao — click job → mở annotate.

**Main:**

- Topbar: *Jobs được giao*
- Bảng: Task, Job, Assignee, State, Action, Cập nhật, **Mở**

Empty state: chưa có job → gợi ý liên hệ admin.

---

## 6. Workspace annotation (`annotate`)

Màn hình làm việc chính: gán caption, bbox, segment cho từng ảnh trong job.

### 6.1 Sidebar (trong annotate)

- **Admin:** section Tasks + Jobs (lọc job theo task chọn); click job khác → load job (nonce reload).
- **Non-admin:** *Jobs được giao* — một dòng task · job + state.
- Footer: Admin Settings, Sign Out.

### 6.2 Topbar annotation

| Vùng | Nội dung |
|------|----------|
| Trái | **← Dashboard**, breadcrumb Task / Job # / **tên file ảnh** (click → copy clipboard) |
| Giữa | Badge lock: vàng nếu mình giữ lock; đỏ **Chỉ xem** nếu người khác đang sửa + **⟳ Thử lại** |
| Phải | **Previous (D)**, **Next (F)**, **Undo (Ctrl+Z)**, **Redo (Ctrl+Y)** |

### 6.3 Thanh tiến độ ảnh

`image-progress-bar`: label `Ảnh i/N (p%)` + slider kéo để nhảy frame.

### 6.4 Thân workspace — 3 cột

```
┌────────────┬─────────────────────────────┬──────────────┐
│ image-list │ canvas-panel                │ props-panel  │
│ ~180px     │ ảnh + overlay box/segment   │ ~240px       │
└────────────┴─────────────────────────────┴──────────────┘
│ caption-bar (footer full width): toolbox + caption fields │
└───────────────────────────────────────────────────────────┘
```

#### Cột trái — Danh sách ảnh

- Header: `Images (N)`
- Nút từng ảnh: số thứ tự + tên file; `.active` = ảnh hiện tại
- Auto-scroll tới item active khi đổi index

#### Cột giữa — Canvas

- `canvas-stage`: nền tối, căn giữa ảnh
- `image-container`: zoom (`scale`) + pan (`translate`); viền slate nhạt
- **Overlay bbox:** viền/màu theo **class** (map màu theo task); tag class góc dưới trái; caption/OCR preview trên box
- Box **selected:** handle 4 góc resize, kéo thân để move; double-click container → reset zoom/pan
- **Segment:** polygon SVG + điểm; draft segment khi đang vẽ (polyline + điểm)
- **Preview** bbox đang kéo: viền dashed cam
- Lớp `draw-capture-layer` khi tool vẽ để bắt chuột trên toàn ảnh
- Empty: *Please select a Job or Task to start annotating*

**Tương tác Pan (H):**

- Click chọn box (Alt/Shift + click = cycle box chồng nhau)
- Ctrl + drag = kéo ảnh
- Scroll wheel = zoom (UI scale bbox/segment giữ cỡ pixel trên màn hình)

#### Cột phải — Properties

- **Boxes (n):** danh sách box ảnh hiện tại; eye ẩn/hiện từng box hoặc tất cả
- **Classes trong Task:** chip màu; click = class mặc định khi vẽ; × xóa label task (nếu không còn dùng)
- **Completed** (chuyển workflow job)
- **Rejected** (reviewer/admin)

### 6.5 Footer — Toolbox & caption

**Tool panel (trái):**

| Tool | Phím | Mô tả ngắn |
|------|------|------------|
| Bbox | B | Kéo vẽ hình chữ nhật; tag hiện class vẽ |
| Track | T | Giống Bbox; box copy từ frame hiện tại đến cuối job (cùng `box.id`) |
| Segment | S | Click thêm điểm; Enter đóng polygon trong bbox |
| Pan | H | Chọn/di chuyển ảnh |
| Caption | N | Focus caption ảnh |
| Zoom | — | Hiển thị %; double-click ảnh → 100% |

- **Chuột phải** nút Bbox / Track / Segment → popover chọn **class khi vẽ** (lọc, tạo class mới)
- Sau vẽ Bbox/Track/Segment xong → tự chuyển **Pan**

**Caption bar fields (phải):**

| Field | Phím | Ghi chú |
|-------|------|---------|
| Image Caption | N | Mô tả cả ảnh |
| Bbox Caption | R | Cần box đang chọn |
| Bbox OCR | O | Text trong vùng box |
| Bbox Class | C | Input + gợi ý class task; Enter tạo mới |

- **Đóng Segment (Enter)** khi đang vẽ segment
- **Delete (X)** — xóa box chọn hoặc clear caption ảnh nếu focus caption; box track xóa từ frame hiện tại trở đi nếu còn trên frame sau

**Context menu** (chuột phải trên box): OCR, Caption, Class.

---

## 7. Modal & overlay

### 7.1 Admin Settings (users)

- Overlay click đóng
- Form tạo/sửa user: username, password, role, supervisor
- Panel danh sách user: click row sửa, nút xóa

### 7.2 Export

- Tuỳ chọn: kèm ảnh hay không
- Box export: all / có caption / có OCR
- Scope: cả task, nhiều job chọn, hoặc một job

---

## 8. Hành vi UX quan trọng

### 8.1 Lock job & chỉ xem

- Mở job → backend lock cho user hiện tại
- User khác mở cùng job: xem được, `canEdit = false` — tool vẽ disabled, save chặn, toast giải thích
- Session keepalive ~15 phút; hết phiên → toast + draft localStorage (nếu có)

### 8.2 Footprint / resume

- Lưu `imageIndex` theo user + job trong localStorage
- Mở lại job → confirm tiếp tục từ ảnh đã lưu hoặc từ đầu

### 8.3 Undo / Redo / Lưu

- Undo/Redo stack annotation trong phiên
- **Ctrl+S** lưu lên server (khi có quyền sửa)
- Blur textarea caption → flush save pending

### 8.4 Màu class

- Gán màu **theo task**, ổn định qua các job trong task
- Box **không đổi màu** khi chỉ select — màu theo class

### 8.5 Box Track (logic UI)

- Không field `trackId` trong JSON
- Cùng `id` trên nhiều frame; xóa ở frame *k* nếu box còn ở *k+1* → gỡ từ *k* đến hết
- Sửa vị trí/kích thước trên một frame **không** sync sang frame khác

---

## 9. Phím tắt tổng hợp (annotation)

| Phím | Hành động |
|------|-----------|
| B | Tool Bbox |
| T | Tool Box Track |
| H | Tool Pan |
| S | Tool Segment / thêm điểm nếu đang segment |
| Enter | Đóng segment |
| N | Focus image caption |
| R | Focus bbox caption |
| O | Focus bbox OCR |
| C | Focus bbox class |
| D / F | Ảnh trước / sau |
| X | Delete selection |
| Escape | Đóng picker / hủy draft segment / bỏ chọn box |
| Ctrl+Z / Ctrl+Y | Undo / Redo |
| Ctrl+S | Lưu annotations |

*(Không ghi đè khi focus input/textarea trừ một số phím global như Ctrl+Z.)*

---

## 10. File tham chiếu code

| File | Vai trò UI |
|------|------------|
| `frontend/src/App.jsx` | Toàn bộ cấu trúc view, canvas, toolbox, modal |
| `frontend/src/App.css` | Token màu, layout grid, component class |
| `frontend/src/main.jsx` | Mount React root |

Khi thêm màn hoặc tool mới, nên cập nhật tài liệu này cùng với class CSS và entry trong bảng phím tắt.
