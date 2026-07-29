# Component — Cơ sở dữ liệu hệ thống gán nhãn & review

## 1. users

| Field | Type | Ghi chú |
|---|---|---|
| id | PK | |
| username | string | unique |
| password | string | hashed |
| role | enum | `admin` / `annotator` / `reviewer` |
| supervisor | FK → users.id, nullable | người quản lý trực tiếp. Thứ bậc: `admin` > `reviewer` > `annotator`. `NULL` với user không có supervisor (vd: admin cấp cao nhất) |

**Business rule:**
- `reviewer` của một `job` = `supervisor` của `annotator` (assignee) đang giữ job đó (xác định tự động, không lưu cột riêng).
- Ràng buộc thứ bậc role (annotator phải có supervisor là reviewer, reviewer phải có supervisor là admin...) xử lý ở tầng application, không enforce bằng DB constraint.

---

## 2. task

| Field | Type | Ghi chú |
|---|---|---|
| id | PK | |
| name | string | mặc định `#id` |
| job_num | **derived** | = COUNT(jobs WHERE task_id = task.id) — không lưu cứng |
| process | **derived** | = % jobs có `state = completed` trên tổng job_num — không lưu cứng |
| classes | text[] | danh sách class của task, dùng làm gợi ý khi gán nhãn box. Cho phép `append` (thêm class mới, không kiểm tra trùng ở DB — xử lý ở app) và `remove` (xóa 1 class) |
| min_role_to_add_class | enum | role thấp nhất được phép tự thêm class mới: `admin` / `reviewer` / `annotator`. Mặc định `admin`. Theo thứ bậc `admin` > `reviewer` > `annotator`: set `reviewer` nghĩa là reviewer và admin thêm được, annotator thì không |
| golden_per_job | int | số lượng ảnh golden được tự động chèn vào mỗi job khi job đó chuyển `need review` lần đầu |
| chunk_size | int | số ảnh mỗi job khi tạo task (dùng để chia danh sách ảnh đầu vào thành các job) |
| modifier | FK → users.id | user thực hiện thao tác gần nhất trên task (tạo task cũng tính là 1 lần modify) |
| created_at | timestamp (GMT+7) | |
| updated_at | timestamp (GMT+7) | |

**Business rule cho `classes`:**
- Thêm class mới: chỉ user có role ≥ `min_role_to_add_class` (theo thứ bậc `admin` > `reviewer` > `annotator`) mới được tự thêm class lạ khi gán nhãn
- Xóa class khỏi `task.classes`: **cascade xóa toàn bộ `boxes` đang có `class` đó** (trong tất cả job thuộc task)
- Việc kiểm tra trùng lặp khi append do application xử lý, không enforce ở DB

**Business rule khi tạo task:**
- Nhận vào danh sách ảnh đầu vào + `chunk_size` → chia thành các `jobs`, mỗi job chứa tối đa `chunk_size` ảnh (job cuối có thể ít hơn nếu số ảnh không chia hết)

> `job_num` và `process` tính bằng VIEW hoặc trigger cập nhật, không lưu cột cứng để tránh lệch dữ liệu.

---

## 3. jobs

| Field | Type | Ghi chú |
|---|---|---|
| id | PK | |
| task_id | FK → task.id | |
| state | enum | `new` / `in progress` / `need review` / `completed` / `rejected` |
| img_num | **derived** | = COUNT(images WHERE job_id = job.id) — không lưu cứng |
| annotator_process | int | index ảnh được annotator xem lần cuối (dùng khi `state = in_progress`). Yêu cầu `images` có `order_index` cố định trong job |
| review_s1_process | int | index ảnh reviewer xem lần cuối ở stage 1 (dùng khi `state = need_review, review_stage = 1`). Reset về `0` mỗi khi job chuyển sang `need_review` (kể cả lần 2, lần 3 sau khi bị reject) |
| review_s2_process | int | số lượng box đã được Accept/Reject ở stage 2 (dùng khi `state = need_review, review_stage = 2`). Reset về `0` khi job chuyển sang `review_stage = 2` |
| assignee | FK → users.id | chỉ gán được cho user có role `annotator`; **không đổi assignee sau khi đã gán** |
| locked_by | FK → users.id, nullable | user đang giữ lock |
| locked_at | timestamp, nullable | thời điểm lock (cập nhật mỗi lần có hành động của user đang giữ, kể cả xem ảnh) |
| review_stage | int, nullable | `1` hoặc `2` — giai đoạn review hiện tại khi job ở state `need review`. Mặc định `1` khi job chuyển sang `need review`, chuyển `2` khi reviewer hoàn thành kiểm tra đủ box ở stage 1 |
| golden_injected | boolean | mặc định `False`. Đánh dấu job đã được chèn ảnh golden hay chưa — chỉ chèn **đúng 1 lần** ở lần đầu tiên job chuyển sang `need review`, kể cả khi job bị reject rồi quay lại `need review` lần sau cũng không chèn thêm |
| modifier | FK → users.id | user thực hiện thao tác gần nhất trên job (đổi state, sửa process...) |
| created_at | timestamp (GMT+7) | |
| updated_at | timestamp (GMT+7) | |

**State machine:**

```
new / rejected --[annotator thao tác box/image]--> in progress
in progress --[annotator bấm Submit]--> need review
need review --[reviewer: Accept]--> completed
need review --[reviewer: Reject]--> rejected
```

**Lock rule theo state:**

| State | Ai giữ lock | Điều kiện nhả lock |
|---|---|---|
| `new` | không lock | — |
| `in progress` | annotator (assignee) | tự động nhả sau 30' không phát sinh log nào trên job đó |
| `need review` | reviewer | **không timeout** — chỉ nhả khi reviewer bấm Accept hoặc Reject |
| `completed` | không lock | — |
| `rejected` | không lock (annotator vào lại → job tự chuyển `in progress` và bị lock) | — |

**Lưu ý khi `rejected`:** giữ nguyên toàn bộ `tag`/`status`/`details` mà reviewer đã đánh dấu trên image/box, để annotator biết chỗ cần sửa (không reset về `Unseen`).

**Lưu ý về admin và lock:** Admin **không override lock** của người đang giữ job — nếu job đang bị khóa bởi 1 user (annotator hoặc reviewer), admin chỉ xem được, không sửa được cho tới khi người đó nhả lock. "Ai truy cập trước khóa cho người đó" áp dụng chung cho cả reviewer lẫn admin khi cùng cố mở 1 job đang `need review` chưa ai giữ.

---

## 4. images

| Field | Type | Ghi chú |
|---|---|---|
| id | PK | |
| task_id | FK → task.id | dùng để xác định ảnh thuộc golden pool của task nào khi `job_id = -1` |
| job_id | FK → jobs.id, hoặc `-1` | `-1` nghĩa là ảnh đang nằm trong **golden pool**, chưa thuộc job nào |
| is_golden | boolean | mặc định `False`. `True` = ảnh golden (đáp án chuẩn do admin thêm, hoặc bản copy được chèn vào job để đánh giá ngầm reviewer) |
| image_source | string | **relative path** tới file ảnh (không phải URL tuyệt đối), được map vào volume Docker qua biến môi trường (vd: `STORAGE_ROOT` trong `.env`) — path lưu trong DB không đổi dù đổi môi trường deploy |
| order_index | int | thứ tự ảnh trong job (dùng để đối chiếu với `jobs.annotator_process` / `jobs.review_s1_process`). Không áp dụng khi `job_id = -1` |
| tag | text[] | vd `["Thiếu box", "Sai Caption", "Thừa box"]` hoặc `"Accept S1"` hoặc `"Accept All"` |
| status | **derived** | `Unseen` / `Accepted` / `Rejected` — suy ra tự động từ trạng thái các `boxes` con (xem quy tắc bên dưới), không lưu cứng, không ai set tay |
| caption | string | |
| details | string | mô tả chi tiết cho tag |
| modifier | FK → users.id | user thực hiện thao tác gần nhất trên ảnh (tạo, sửa tag/caption/details đều tính) |
| created_at | timestamp (GMT+7) | |
| updated_at | timestamp (GMT+7) | |

**Quyền thao tác:**
- Annotator: sửa `tag`, `caption`, `details`
- Reviewer/Admin: sửa `tag` (gắn `Accept S1`/`Accept All` khi duyệt xong stage tương ứng), `caption`, `details`
- `status` không ai set trực tiếp — hệ thống tự tính

**Quy tắc suy ra `image.status` (derived):**
- `Accepted` nếu và chỉ nếu ảnh có tag **`Accept All`** (đã qua cả stage 1 lẫn stage 2, mọi box đều `Accepted`, caption không bị tag `Sai Caption`)
- `Rejected` nếu ảnh có bất kỳ tag lỗi nào (`Thiếu box`, `Sai Caption`, `Thừa box`...) và chưa có `Accept All`
- `Unseen` nếu ảnh chưa được reviewer chạm tới lần nào (chưa có tag nào)

**Lưu ý về tag `Accept S1`:**
- **Không** làm ảnh thành `Accepted` — chỉ là dấu mốc "đã qua kiểm tra đủ box ở stage 1"
- Dùng để **lần review sau** (job bị reject rồi quay lại `need review`, hoặc reviewer review lại từ đầu): reviewer có thể **bỏ qua ảnh đã có `Accept S1`** khi rà ở stage 1, tập trung vào ảnh chưa qua stage 1
- Một ảnh có thể có `Accept S1` nhưng vẫn `status = Rejected` (vì box lỗi ở stage 2, hoặc sai caption) cho tới khi đạt `Accept All`
- **Reset (gỡ bỏ) `Accept S1`** chỉ khi annotator **thêm hoặc xóa box** (`add_box` / `delete_box`) thuộc ảnh đó — vì hành động này làm thay đổi **số lượng** box, ảnh hưởng tới tính đủ ở stage 1. Riêng `edit_box` (sửa field của box có sẵn, không đổi số lượng) thì **không** reset `Accept S1`, vì stage 1 chỉ quan tâm đủ/thiếu box, không quan tâm chi tiết box

**Golden pool:**
- Admin thêm ảnh + nhãn chuẩn vào pool: tạo `images` với `job_id = -1`, `is_golden = true`, gắn `task_id`
- Khi job chuyển `need review` lần đầu (`golden_injected = False`): hệ thống **copy** ngẫu nhiên `task.golden_per_job` ảnh (kèm box) từ pool, gán `job_id` = job đó, giữ `is_golden = true` — dùng để đánh giá ngầm reviewer có phát hiện đúng lỗi/đúng chuẩn không
- Admin có thể vào màn hình duyệt ảnh, chọn 1 ảnh bất kỳ (kèm nhãn hiện có) để thêm vào golden pool

---

## 5. boxes

| Field | Type | Ghi chú |
|---|---|---|
| id | PK | |
| img_id | FK → images.id | |
| is_golden | boolean | mặc định `False`, đồng bộ theo `images.is_golden` của ảnh chứa nó |
| tag | text[] | |
| status | enum | `Unseen` / `Accepted` / `Rejected` — mặc định `Unseen` |
| modifier | FK → users.id | user đã chỉnh sửa gần nhất |
| class | string | |
| box_points | string | các bộ `x_center y_center w h` đã normalize |
| segment_points | string | các cặp điểm `x1 y1 x2 y2 ...` đã normalize |
| ocr_text | string | |
| caption | string | |
| details | string | mô tả chi tiết cho tag |
| created_at | timestamp (GMT+7) | |
| updated_at | timestamp (GMT+7) | |

**Quyền thao tác:**
- Annotator: thêm / sửa / xóa box, sửa `tag`, `class`, `box_points`, `segment_points`, `ocr_text`, `caption`, `details` — **không được set `status`**
- Reviewer/Admin: sửa mọi field kể trên, và set `status`

**Quy tắc `status` (bán tự động):**
- Nếu `box.tag` khác rỗng (có bất kỳ tag lỗi nào) → `status = Rejected` **tự động**, reviewer không cần bấm reject tay
- Nếu reviewer đã sửa box xong (vd: sửa đúng class, đúng segment...) và muốn ghi nhận đạt yêu cầu dù từng có tag → reviewer chủ động set `status = Accepted` (được phép accept dù trước đó có tag, miễn là đã sửa xong)
- Nếu không có tag và reviewer thấy đạt yêu cầu ngay từ đầu → reviewer set `status = Accepted`

---

## 6. logs

| Field | Type | Ghi chú |
|---|---|---|
| id | PK | |
| actor | FK → users.id | người thực hiện hành động |
| action | enum | `view_image` / `add_box` / `edit_box` / `delete_box` / `edit_image_tag` / `change_job_state` / `add_class` / `remove_class` / ... |
| target_type | enum | `task` / `job` / `image` / `box` / `user` / `class` |
| target_id | int | id của đối tượng bị tác động |
| detail | string | mô tả hành động (vd: "thêm box", "sửa box", "reject job — lý do X") |
| created_at | timestamp (GMT+7) | |

**Mục đích:**
- Audit trail đầy đủ: ai sửa gì, khi nào, trên đối tượng nào
- `view_image` được ghi log mỗi khi annotator chuyển sang ảnh khác (kể cả không gán nhãn gì) — đảm bảo hành động "lướt ảnh" cũng tính là hoạt động, không bị tính nhầm là "không hoạt động"
- Là căn cứ để hệ thống tự nhả lock `in progress` (30' không phát sinh **bất kỳ log nào** — kể cả `view_image` — liên quan đến job đó)

---

## 7. Tổng hợp dữ liệu derived (không lưu cứng, tính động qua VIEW/trigger)

| Field | Công thức |
|---|---|
| `task.job_num` | COUNT(jobs WHERE task_id = task.id) |
| `task.process` | % (jobs.state = 'completed') / task.job_num |
| `jobs.img_num` | COUNT(images WHERE job_id = job.id, job_id != -1) |
| `images.status` | `Accepted` nếu tag chứa `Accept All`; `Rejected` nếu có tag lỗi mà chưa `Accept All`; `Unseen` nếu chưa có tag nào (`Accept S1` không tính vào status, chỉ là mốc bỏ qua stage 1 lần sau) |

---

## 8. Quy tắc xóa

- **Task:** xóa được. Khi xóa task → **cascade xóa toàn bộ `jobs`, `images`, `boxes`** thuộc task đó (bao gồm cả golden pool của task)
- **Job / Image (riêng lẻ):** admin **không được xóa trực tiếp** — chỉ mất đi khi task chứa nó bị xóa
- **User:** admin thêm/xóa được. Khi xóa user đang là `assignee`/`locked_by` của job, cần xử lý ở app (chặn xóa nếu đang có job active, hoặc yêu cầu gỡ gán trước)
- **Class trong `task.classes`:** xóa 1 class → cascade xóa các `boxes` đang mang class đó

---

## 9. Enum đề xuất (bạn xem rồi thêm/bớt)

**`users.role`**
```
admin, annotator, reviewer
```

**`task.min_role_to_add_class`**
```
admin, reviewer, annotator
```

**`jobs.state`**
```
new, in_progress, need_review, completed, rejected
```

**`jobs.review_stage`** (int, không phải enum)
```
1, 2
```

**`images.status` / `boxes.status`**
```
Unseen, Accepted, Rejected
```

**`images.tag`** (text[], giá trị gợi ý — không giới hạn cứng vì có thể tùy task)
```
"Thiếu box", "Thừa box", "Sai Caption", "Accept S1", "Accept All"
```

**`boxes.tag`** (text[], gợi ý — box không có khái niệm "thiếu/thừa box" vì bản thân nó là 1 box)
```
"Sai class", "Sai OCR", "Sai Caption", "Sai segment", "Sai box_points"
```

**`logs.target_type`**
```
task, job, image, box, user, class
```

**`logs.action`** (gợi ý đầy đủ dựa trên toàn bộ nghiệp vụ đã thảo luận)
```
create_task
delete_task
add_class
remove_class

add_user
remove_user
assign_job

view_image
add_box
edit_box
delete_box
edit_image_tag        (annotator/reviewer sửa tag/caption/details của image)
edit_box_tag          (reviewer gắn tag lỗi cho box)

submit_job            (annotator: in_progress -> need_review)
accept_job            (reviewer: need_review -> completed)
reject_job            (reviewer: need_review -> rejected)

lock_job              (bắt đầu giữ lock — annotator hoặc reviewer)
unlock_job_auto       (hệ thống tự nhả lock sau 30' không hoạt động)
unlock_job_manual     (reviewer bấm accept/reject -> tự nhả lock)

add_to_golden_pool    (admin thêm ảnh vào golden pool)
inject_golden_images  (hệ thống tự chèn ảnh golden vào job lần đầu need_review)
```

> Đây là danh sách khởi điểm — bạn rà lại, cái nào thừa/thiếu thì báo để chốt bản cuối trước khi code (đổi enum sau khi đã có dữ liệu sẽ tốn công migrate hơn nhiều so với chốt trước).

---

## 10. Index đề xuất

| Bảng | Cột | Lý do |
|---|---|---|
| jobs | task_id | liệt kê job theo task |
| jobs | assignee | annotator xem "job của tôi" |
| jobs | (state, assignee) | filter job theo trạng thái + người phụ trách (dashboard) |
| jobs | locked_by | kiểm tra ai đang giữ job |
| images | job_id | liệt kê ảnh theo job |
| images | (task_id, is_golden) | truy vấn golden pool theo task |
| boxes | img_id | liệt kê box theo ảnh |
| logs | (target_type, target_id) | tra cứu lịch sử của 1 object cụ thể |
| logs | created_at | lọc log theo thời gian, tính lock timeout |
| logs | actor | lịch sử thao tác của 1 user |

---

## 11. Sơ đồ quan hệ (tổng quan)

```
users (supervisor tự tham chiếu users.id)
  └─< jobs.assignee (chỉ annotator)
  └─< jobs.locked_by
  └─< logs.actor
  └─< boxes.modifier

task
  ├─< jobs (task_id)
  │     └─< images (job_id = jobs.id)
  │           └─< boxes (img_id)
  └─< images (task_id, job_id = -1)   ← golden pool riêng của task
        └─< boxes (img_id)

logs (target_type + target_id) --> job / image / box (polymorphic, không FK cứng)
```
