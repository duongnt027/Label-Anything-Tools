# UI — Giao diện hệ thống gán nhãn & review

## 0. Đăng nhập

- Màn hình login đơn giản: username / password
- Tạo sẵn 3 user mặc định (seed data):
  | username | password | role |
  |---|---|---|
  | admin | 1 | admin |
  | annotator1 | 1 | annotator |
  | reviewer1 | 1 | reviewer |

---

## 1. Layout chính (áp dụng cho mọi role)

**Sidebar (bên trái)**
- Tên app trên cùng
- Nút extend/collapse ngay dưới tên app
- (Riêng admin) mục **User Setting**
- Nút Sign out ở dưới cùng

**Main screen**
- Nội dung thay đổi theo role, hiển thị dashboard tương ứng

---

## 2. Role: Annotator

### 2.1. Dashboard
Danh sách job được assign cho annotator đó, mỗi dòng/thẻ hiển thị:
- `id` job
- Số lượng ảnh (`img_num`)
- Process (progress bar theo `jobs.annotator_process` / `img_num`)
- Nút **Mở** job

### 2.2. Màn hình làm job

**Thanh trên cùng**
- Nút thoát ra dashboard
- Tên ảnh hiện tại
- Process của job (vị trí ảnh hiện tại / tổng số ảnh)

**Thanh trái**
- Danh sách class có trong ảnh hiện tại
- Danh sách box trong ảnh
- Nút **Submit** — sáng lên khi đã đi qua ảnh cuối cùng của job (dựa trên `jobs.annotator_process` = `img_num`)
- Danh sách tag của ảnh (image.tag)
- Danh sách tag của từng box (box.tag) — bấm vào 1 tag sẽ **focus** vào box tương ứng trên canvas; sau khi annotator sửa xong lỗi ứng với tag đó, có nút **x** để tự tay đóng/xóa tag đó khỏi danh sách

**Khu vực giữa (canvas chính)**
- Thanh công cụ (toolbar): Box / Segment / Hand (di chuyển, pan/zoom)
- Caption của ảnh (editable)
- Caption của box đang chọn (editable, chỉ hiện/sửa được khi có box đang được chọn)
- Class của box đang chọn

**Thanh phải**
- Danh sách ảnh trong job dạng thumbnail/list, mỗi ảnh có chấm trạng thái:
  - 🟢 xanh: ảnh `Accepted`
  - 🔴 đỏ: ảnh `Rejected`
  - ⚪ xám: `Unseen` (chưa xem đến)

---

## 3. Role: Reviewer

### 3.1. Dashboard
Danh sách job thuộc các annotator mà reviewer đó supervise trực tiếp (`users.supervisor = reviewer.id`), mỗi dòng/thẻ hiển thị:
- `id` job
- Số lượng ảnh
- Process (progress bar)
- Nút **Mở** job

### 3.2. Màn hình review — tùy theo `jobs.review_stage`

**Thanh trên cùng (chung cho cả 2 stage)**
- Nút thoát ra dashboard
- Tên ảnh hiện tại
- Process của job:
  - Stage 1: `jobs.review_s1_process` / tổng số ảnh
  - Stage 2: `jobs.review_s2_process` / tổng số box

**Stage 1 — kiểm tra đủ box**
- Hiển thị ảnh + toàn bộ box trên ảnh đó (không phân biệt class, xem tổng thể)
- Thanh phải:
  - Danh sách tag hiện có trên ảnh
  - Danh sách tag có thể chọn để gắn thêm (vd: `Thiếu box`, `Thừa box`)
- Nút **Continue** — sáng lên khi đã **xem hết** toàn bộ ảnh trong job (không bắt buộc phải gắn tag mới sáng, giống nguyên tắc "xem hết" của nút Submit bên annotator) → chuyển `review_stage = 2`
- Ảnh nào không bị gắn tag lỗi nào ở stage 1 → tự động gắn tag `Accept S1`

**Stage 2 — kiểm tra chi tiết từng box, chia theo section theo class**
- Giao diện chia thành các **section theo class** (mỗi class 1 section)
- Trong mỗi section: các thẻ (card) box, mỗi thẻ có padding, hiển thị:
  - Ảnh crop theo box, vẽ box/segment
  - OCR text
  - Caption của box
  - Danh sách tag hiện có trên box
  - Danh sách tag có thể thêm
  - Nút **Accept** / **Reject** cho box đó
- Cuối trang (sau khi kéo qua hết mọi section): nút **Submit**
- Quy tắc tự động khi bấm Submit mà reviewer chưa tự tay accept/reject hết:
  - Box không có tag nào → tự động **Accept**
  - Box có ít nhất 1 tag → tự động **Reject**

---

## 4. Role: Admin

### 4.1. Sidebar riêng của admin
- Thêm mục **User Setting** → mở popup gồm 2 phần:
  - Trái: danh sách user hiện có
  - Phải: form tạo mới / sửa user đang chọn — sửa được đầy đủ các field, kể cả `role` và `supervisor` (không giới hạn chỉ sửa password/tên)

### 4.2. Dashboard
- Nút **Tạo task**
- Danh sách task hiện có, mỗi dòng hiển thị: tên task, số lượng job (`job_num`), process (`task.process`), nút **Mở** task

### 4.3. Popup tạo task
- Nhập ảnh đầu vào theo 1 trong 2 cách:
  - Import folder ảnh (upload trực tiếp)
  - Chọn folder có sẵn từ ổ đĩa mount sẵn (path trên server/volume)
- Các field khác của `task` (name, chunk_size, classes, min_role_to_add_class, golden_per_job...) nhập kèm ở đây

### 4.4. Màn hình bên trong 1 task
- Thanh công cụ: nút **Import** (label có sẵn), **Export** (ảnh + annotation của task), **Delete** (xóa task)

**Format export annotation (JSON, theo từng ảnh):**
```json
{
  "id": 1698,
  "path": "/data/tasks/58/jobs/650/images/traffic_001697.jpg",
  "caption": null,
  "bboxes": [
    {
      "id": 1,
      "x": 0.388964,
      "y": 0.405076,
      "w": 0.008965,
      "h": 0.017424,
      "caption": "",
      "ocr": "",
      "class": "P.102",
      "segment": [],
      "visible": true
    },
    {
      "id": 2,
      "x": 0.388805,
      "y": 0.422785,
      "w": 0.010664,
      "h": 0.019174,
      "caption": "",
      "ocr": "",
      "class": "R.302a",
      "segment": [],
      "visible": true
    }
  ]
}
```
- Export trả về **danh sách các object ảnh** như trên (mỗi ảnh 1 object), gộp theo task hoặc theo job tùy lựa chọn khi export
- `x, y, w, h` lấy trực tiếp từ `boxes.box_points` (đã normalize sẵn theo thiết kế DB)
- `segment` lấy từ `boxes.segment_points`, để mảng rỗng `[]` nếu box không có segment
- `visible` — field mới xuất hiện ở format export, cần xác nhận thêm: field này có tương ứng 1-1 với `boxes.status != Rejected` không, hay là 1 khái niệm khác (ẩn/hiện box khi vẽ) cần lưu riêng trong DB?

- 2 khu vực chính:
  1. **Golden pool** — 1 dashboard hiển thị danh sách ảnh đang có trong pool của task (dạng lưới/thumbnail). Bấm vào 1 ảnh sẽ mở ra **màn hình y hệt màn hình annotator** (toolbar box/segment/hand, caption, class, danh sách box...) để thêm/sửa nhãn trực tiếp trên ảnh golden đó — nhưng **không có nút Submit chuyển cho reviewer** (vì ảnh golden không thuộc job nào, không đi qua flow review)
  2. **Jobs list** — danh sách job của task, có 3 tab lọc ở trên đầu:
     - Theo Annotator (job đang ở giai đoạn annotator làm — `new`/`in progress`/`rejected`)
     - Theo Reviewer stage 1 (`need review`, `review_stage = 1`)
     - Theo Reviewer stage 2 (`need review`, `review_stage = 2`)

### 4.5. Quyền hạn đặc biệt của admin
- Vào được bất kỳ job nào và **chọn hiển thị màn hình theo role** (xem như annotator hoặc như reviewer đang thấy)
- Trong màn hình duyệt ảnh (dù ở vai trò nào), có thêm nút **thêm ảnh này (kèm nhãn hiện tại) vào Golden Pool**
- Lock: admin không override lock của người đang giữ job — chỉ xem, không sửa được cho tới khi họ nhả lock

---

## 5. Ghi chú export/import (đã chốt)

- **`visible`**: không phải field lưu cứng trong DB, mà là giá trị được tính tại **thời điểm export**, phản ánh `boxes.status != Rejected`. Nút Export có tuỳ chọn **"bao gồm cả box bị ẩn (Rejected) hay không"** — nếu người dùng chọn loại trừ, các box `Rejected` sẽ không xuất hiện trong file export (hoặc xuất hiện với `visible: false` tuỳ theo tuỳ chọn)
- **Phạm vi export**: luôn export **toàn bộ task** (tất cả job, tất cả ảnh, không phân biệt state `completed`/`rejected`/`in progress`...) — không lọc theo trạng thái
- **Import**: dùng **cùng format JSON** với export (danh sách object ảnh có `id`, `path`, `caption`, `bboxes`). Import khớp theo `path` để xác định ảnh tương ứng đã tồn tại trong hệ thống, ghi đè/thêm nhãn (`bboxes`) vào ảnh đó
