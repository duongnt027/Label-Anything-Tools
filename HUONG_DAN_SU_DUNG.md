# Hướng dẫn sử dụng Label Anything

Tài liệu hướng dẫn thao tác trên hệ thống **gán nhãn và review ảnh** Label Anything, từ thiết lập task (admin) đến gán nhãn (annotator) và duyệt (reviewer).

---

## Mục lục

1. [Giới thiệu và đăng nhập](#1-giới-thiệu-và-đăng-nhập)
2. [Admin — Quản lý task](#2-admin--quản-lý-task)
3. [Admin — Golden pool](#3-admin--golden-pool)
4. [Admin — Jobs và gán việc](#4-admin--jobs-và-gán-việc)
5. [Annotator — Gán nhãn job](#5-annotator--gán-nhãn-job)
6. [Reviewer — Duyệt job](#6-reviewer--duyệt-job)
7. [Import / Export dữ liệu](#7-import--export-dữ-liệu)
8. [Phím tắt và mẹo](#8-phím-tắt-và-mẹo)
9. [Luồng tổng quan](#9-luồng-tổng-quan)
10. [Tài liệu kỹ thuật](#10-tài-liệu-kỹ-thuật)

---

## 1. Giới thiệu và đăng nhập

### 1.1. Vai trò

| Role | Mô tả ngắn |
|------|------------|
| **admin** | Tạo task, import/export, golden pool, gán annotator, quản lý user, xem mọi job |
| **annotator** | Làm job được giao: vẽ box, caption, class, submit |
| **reviewer** | Duyệt job ở stage 1 và stage 2 sau khi annotator submit |

### 1.2. Đăng nhập

1. Mở ứng dụng (ví dụ `http://localhost:8080` hoặc URL production).
2. Nhập **Username** và **Password** do quản trị cấp.
3. Bấm **Login**.

Hệ thống chuyển tới dashboard theo role: admin → task dashboard; annotator → jobs được giao; reviewer → jobs cần duyệt.

---

## 2. Admin — Quản lý task

### 2.1. Dashboard task

- Sidebar: dashboard admin.
- Bảng task: tên, ngày tạo, số job, số ảnh, tiến độ hoàn thành.
- **+ Task**: mở modal **Tạo task**.

### 2.2. Tạo task (+ Task)

| Trường | Ý nghĩa |
|--------|---------|
| **Tên task** | Tùy chọn; bỏ trống thì hệ thống đặt tên theo id |
| **Chunk size** * | Số ảnh tối đa **mỗi job** — **bắt buộc ≥ 2** |
| **Min role thêm class** | Role thấp nhất được tự thêm class mới khi gán nhãn |
| **Golden / job** | Số ảnh golden chèn vào mỗi job lần đầu vào review — **bắt buộc ≥ 2** |
| **Classes** | Nhập tên → **Enter** thêm chip; **×** trên chip xóa class (xóa luôn box có class đó trên task) |
| **Mount / Upload ZIP** | Nguồn ảnh ban đầu (xem mục 7) |

**Mount (dataset lớn, khuyến nghị):**

- Duyệt cây thư mục dưới `STORAGE_ROOT` (ví dụ `sample_images/test`).
- Chỉ **file ảnh trực tiếp** trong thư mục đã chọn; hệ thống **tham chiếu** path, không copy.

**Upload ZIP:**

- Kéo thả file `.zip` lên modal hoặc chọn file (tab **Upload ZIP**).
- Cấu trúc: **một** thư mục con chứa ảnh (cấp 1); tùy chọn **một** `annos.json` ở gốc ZIP hoặc trong thư mục ảnh.
- Trong lúc **Đang tạo…**, toàn bộ thao tác trên modal bị khóa.

Bấm **✓ Tạo** để tạo task và tự chia **jobs** theo chunk size.

### 2.3. Chi tiết task

Bấm icon mở task trên dashboard → hai tab **Golden pool** và **Jobs**.

Thanh công cụ: **Import** (bổ sung ảnh/nhãn task), **Export**, **Delete task**, **Assignees**.

---

## 3. Admin — Golden pool

Golden pool là tập **ảnh chuẩn** (kèm nhãn) của task, dùng khi job vào review (hệ thống chèn ngẫu nhiên `golden_per_job` ảnh vào job).

### 3.1. Import golden pool

1. Tab **Golden pool** → **Import**.
2. **Mount** hoặc **Upload ZIP** (cùng quy tắc ZIP như tạo task).
3. Nếu `annos.json` đi kèm, nhãn gán theo **tên file**; bbox dạng `x_center`, `y_center`, `w`, `h` (0–1).
4. **Trùng tên** với ảnh đã có trong pool: file mới đổi thành `ten-0.jpg`, `ten-1.jpg`, … và nhãn map đúng ảnh mới (không ghi đè ảnh cũ).
5. Trong lúc import, modal bị khóa cho đến khi xong.

### 3.2. Quản lý danh sách

- Tick ảnh → **Export pool** hoặc **Xóa đã chọn**.
- **Import** thêm ảnh bất kỳ lúc nào.
- Bấm icon mở ảnh → **Golden editor** (chỉnh nhãn như màn annotate).

---

## 4. Admin — Jobs và gán việc

### 4.1. Tab Jobs

- Danh sách job: id, số ảnh, state, assignee, tiến độ review.
- Tick job → export nhiều job; từng job có **Export** riêng.
- Admin đổi **state** job qua dropdown (vận hành / debug).

### 4.2. Assignees

1. Bấm **Assignees** trên task.
2. Thêm/bớt user annotator được phép nhận job của task này.
3. User bị gỡ khỏi pool sẽ bị **unassign** khỏi job chưa hoàn thành.

### 4.3. Gán job

1. Cột **Assignee** trên từng job: chọn username (combobox).
2. Mỗi job **một** annotator; sau khi gán thường **không đổi** assignee.
3. Annotator chỉ thấy job **đã gán cho mình**.

### 4.4. Mở job (admin)

- Icon mở job: xem màn annotate/review (có thể chuyển view annotator / reviewer qua admin switcher).
- Job đang **lock** bởi user khác → admin **chỉ xem**, không sửa, đến khi họ thoát hoặc timeout lock.

---

## 5. Annotator — Gán nhãn job

### 5.1. Dashboard

- **Jobs được giao**: id job, số ảnh, tiến độ xem, state, nút mở job.

| State | Ý nghĩa |
|-------|---------|
| `new` / `rejected` | Cần làm hoặc làm lại |
| `in_progress` | Đang làm (job lock cho bạn) |
| `need_review` | Đã submit — chờ reviewer |
| `completed` | Đã duyệt xong |

### 5.2. Màn làm job

**Thanh trên:** quay lại, tên file (copy), tiến độ ảnh, **Submit** (sáng ở **ảnh cuối**).

**Canvas — công cụ:**

| Công cụ | Phím | Chức năng |
|---------|------|-----------|
| Box | **B** | Kéo vẽ hình chữ nhật (tối thiểu ~4px) |
| Segment | **S** | Click điểm; **Enter** đóng polygon (≥3 điểm) |
| Hand | **H** | Chọn/kéo/resize; **Ctrl+kéo** pan ảnh |

**Phím khác:** **X** / **Delete** xóa box chọn; **Ctrl+Z** / **Ctrl+Shift+Z** undo/redo; **D**/**←** ảnh trước, **F**/**→** ảnh sau.

**Footer:** Image caption; Box caption, OCR, Class (khi chọn box).

**Lưu dữ liệu:**

- Tự lưu caption/OCR/class khi **chuyển ảnh** hoặc **chọn box khác**.
- **Ctrl+S** (Cmd+S trên Mac): lưu thủ công (hiện **Saved**).
- Box/segment: lưu ngay khi vẽ hoặc chỉnh hình học.

**Cột trái/phải:** danh sách box, class task, tag ảnh/box (nếu review trả lại), danh sách ảnh job.

### 5.3. Lock job

- Mở job → lock → state `in_progress`.
- Nút **←** quay dashboard → nhả lock.
- Không thao tác lâu (mặc định ~30 phút) → lock có thể tự nhả.

### 5.4. Submit

1. Hoàn thành nhãn theo yêu cầu dự án.
2. Tới **ảnh cuối**.
3. Bấm **Submit** → job **need_review**.

### 5.5. Job bị reject

- Mở lại job → sửa theo tag/box reviewer → **Submit** lại.

---

## 6. Reviewer — Duyệt job

### 6.1. Dashboard reviewer

- Danh sách job **need_review** (và trạng thái liên quan).
- Mở job → **Review stage 1** hoặc **stage 2** tùy cấu hình job.

### 6.2. Stage 1 (từng ảnh)

- Duyệt từng ảnh: tag lỗi (thiếu box, thừa box, sai caption…), chấp nhận/từ chối box.
- Hoàn thành hết ảnh → chuyển stage 2 hoặc kết thúc theo quy trình task.

### 6.3. Stage 2

- Duyệt tổng thể job; quyết định **completed** hoặc **rejected** trả về annotator.

*(Chi tiết tag và nút trên UI: xem màn hình review trong ứng dụng — admin có thể mở cùng job với `view_as=reviewer`.)*

---

## 7. Import / Export dữ liệu

### 7.1. Export

- **Task / job / golden pool**: ZIP gồm `annos.json` + tùy chọn thư mục `images/`.
- Bbox trong JSON: `x_center`, `y_center`, `w`, `h` (normalized), kèm `class`, `caption`, `ocr`, …
- `path` trong JSON là **tên file ảnh** (basename).

### 7.2. Import task (admin, trên task)

- **Import** trên chi tiết task: file ZIP export hoặc riêng `annos.json`.
- Khớp nhãn theo tên file ảnh đã có trong task.

### 7.3. Import golden pool

- Xem mục [3.1](#31-import-golden-pool).

### 7.4. Cấu trúc ZIP chuẩn (tạo task / golden)

```text
my_dataset.zip
├── annos.json          (tùy chọn)
└── images/             (một thư mục duy nhất ở cấp 1)
    ├── a.jpg
    ├── b.jpg
    └── ...
```

`annos.json` là mảng object: `{ "path": "a.jpg", "caption": "...", "bboxes": [ ... ] }`.

---

## 8. Phím tắt và mẹo

| Ngữ cảnh | Phím | Hành động |
|----------|------|-----------|
| Annotate | B / S / H | Box / Segment / Hand |
| Annotate | X, Delete | Xóa box đang chọn |
| Annotate | Ctrl+Z / Ctrl+Shift+Z | Undo / Redo |
| Annotate | Ctrl+S | Lưu caption & box fields |
| Annotate | D, F, ←, → | Ảnh trước / sau |
| Modal ZIP | Kéo thả | Thả `.zip` lên modal (tự chọn tab Upload ZIP) |

---

## 9. Luồng tổng quan

```text
Admin:  Tạo task (Mount/ZIP) → Golden pool (tùy chọn) → Assignees → Gán job
           ↓
Annotator:  Mở job → Gán nhãn → Submit
           ↓
Reviewer:  Stage 1 → Stage 2 → Completed hoặc Rejected
           ↓
Annotator:  (Nếu rejected) Sửa → Submit lại
```

---

## 10. Tài liệu kỹ thuật

| Tài liệu | Nội dung |
|----------|----------|
| `README.md` | Cài Docker, biến môi trường, chạy local |
| `docs/PRODUCTION.md` | Scale, Cloudflare Tunnel, production |
| `component.md` | Quy tắc nghiệp vụ, DB, golden inject |
| `ui.md` | Mô tả UI đầy đủ |

---

*Bản hướng dẫn này dành cho người dùng vận hành Label Anything. Phiên bản tài liệu: cập nhật theo mã nguồn hiện tại.*
