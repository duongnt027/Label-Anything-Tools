# Production & high concurrency

Hướng dẫn chạy stack chịu **nhiều kết nối đồng thời** (mục tiêu thiết kế ~10.000 client tới edge Cloudflare, với horizontal scale phía sau).  
10.000 người **thật sự** cùng lúc thường cần **nhiều máy**, CDN/WAF, và load test — repo này cung cấp **cấu hình Docker production** làm điểm xuất phát.

## Kiến trúc

```text
Internet → Cloudflare (optional Tunnel) → nginx (web) → api × N (Gunicorn/Uvicorn workers)
                                              ↓
                                         PgBouncer → PostgreSQL
                                              ↓
                                    shared volume (STORAGE_ROOT)
```

| Thành phần | Vai trò |
|------------|--------|
| **Cloudflare** | TLS, DDoS, cache tĩnh, giới hạn tốc độ (khuyến nghị bật Rate Limiting / WAF) |
| **web (nginx)** | SPA, `upstream` tới `api`, keep-alive, proxy upload 500MB |
| **api × N** | Gunicorn + `UvicornWorker`, scale bằng `--scale api=…` |
| **PgBouncer** | Tới ~10.000 client DB logic, pool transaction mode |
| **PostgreSQL** | `max_connections` tăng qua compose prod |

## Chạy production (local / VPS)

1. Sao chép và chỉnh `.env` (xem `.env.example`, đặc biệt `SECRET_KEY` mạnh).

2. Khởi động:

```bash
chmod +x scripts/prod-up.sh
API_REPLICAS=8 ./scripts/prod-up.sh
```

Hoặc thủ công:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build --scale api=8
```

3. Kiểm tra:

```bash
curl -s http://localhost:8080/api/health
```

Dev một máy vẫn dùng `docker compose up --build` (một API, không PgBouncer).

## Biến môi trường (production)

| Biến | Mặc định | Mô tả |
|------|----------|--------|
| `API_REPLICAS` | 4 | Số container `api` (`--scale api=`) |
| `WEB_CONCURRENCY` | 4 | Gunicorn workers **mỗi** container api |
| `GUNICORN_TIMEOUT` | 120 | Timeout request (giây), upload lớn |
| `DB_USE_PGBOUNCER` | true (prod file) | `NullPool` SQLAlchemy qua PgBouncer |
| `PGBOUNCER_MAX_CLIENT_CONN` | 10000 | Client tới PgBouncer |
| `PGBOUNCER_DEFAULT_POOL_SIZE` | 120 | Kết nối thật tới Postgres |
| `POSTGRES_MAX_CONNECTIONS` | 300 | `max_connections` Postgres |
| `POSTGRES_SHARED_BUFFERS` | 256MB | Tune RAM DB |
| `API_CPU_LIMIT` / `API_MEMORY_LIMIT` | 2 / 2G | Giới hạn từng replica api |

**Ước lượng:** tổng worker ≈ `API_REPLICAS × WEB_CONCURRENCY`. Tăng replica trước khi tăng workers quá cao trên một container.

## Cloudflare

### Quick Tunnel — không cần web Cloudflare (trycloudflare.com)

URL dạng `https://something-random.trycloudflare.com`, **miễn phí**, không token, không add domain. Phù hợp demo / chia sẻ nhanh; **URL đổi** mỗi lần restart tunnel.

```bash
chmod +x scripts/quick-tunnel.sh
./scripts/quick-tunnel.sh
```

Hoặc:

```bash
docker compose up -d web
docker compose --profile quicktunnel up -d cloudflared-quick
docker compose logs cloudflared-quick   # dòng https://….trycloudflare.com
```

Dừng tunnel: `docker compose --profile quicktunnel stop cloudflared-quick`

### Named Tunnel (dashboard + domain cố định)

Không cần mở port 80/443 trên firewall — `cloudflared` kết nối ra Cloudflare.

#### 1. Tạo tunnel (Zero Trust)
2. **Create a tunnel** → chọn **Cloudflared**.
3. Đặt tên (vd. `label-anything`).
4. Copy **token** (dạng dài, một lần hiển thị).

#### 2. Public hostname

Trong tunnel → **Public Hostname**:

| Field | Giá trị |
|--------|---------|
| Subdomain | `label` (hoặc tuỳ ý) |
| Domain | domain bạn quản lý trên Cloudflare |
| Service type | HTTP |
| URL | `http://web:80` |

(Lưu ý: URL này là **bên trong Docker network**, dùng khi `cloudflared` chạy cùng compose với service `web`.)

#### 3. `.env`

```env
CLOUDFLARE_TUNNEL_TOKEN=eyJhIjoi...
```

#### 4. Chạy kèm tunnel

```bash
./scripts/prod-up.sh --cloudflare
# hoặc
WITH_CLOUDFLARE=1 API_REPLICAS=8 ./scripts/prod-up.sh
```

Chỉ tunnel (stack prod đã chạy):

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile cloudflare up -d cloudflared
```

#### 5. Cloudflare khuyến nghị thêm

- **SSL/TLS**: Full (strict) nếu có origin cert; với tunnel thường để Full.
- **Caching**: cache asset tĩnh (`*.js`, `*.css`, logo); **không** cache `/api/*`.
- **Rate limiting**: rule theo IP cho `/api/auth/login` và upload.
- **Page Rules / Cache Rules**: bypass cache cho `/api/*`.

## Scale ra nhiều máy (gợi ý)

Một VPS không đủ 10k CPU-bound:

1. Nhiều node chạy cùng image `api`, load balancer (hoặc Cloudflare Load Balancing) trỏ tới các node.
2. Postgres managed (RDS, Cloud SQL) + PgBouncer riêng.
3. Storage ảnh: NFS / S3-compatible object storage (cần chỉnh code sau nếu chuyển S3).
4. Load test: `k6`, `locust` — tăng `API_REPLICAS` và RAM CPU theo kết quả.

## Troubleshooting

| Triệu chứng | Gợi ý |
|-------------|--------|
| 502 từ nginx | `docker compose logs api`, kiểm tra PgBouncer healthy |
| Too many connections | Giảm `WEB_CONCURRENCY` hoặc tăng `PGBOUNCER_DEFAULT_POOL_SIZE` / `POSTGRES_MAX_CONNECTIONS` |
| Tunnel không lên | Token hết hạn / sai; `docker compose logs cloudflared` |
| Upload 413 | Cloudflare body limit (plan); file lớn dùng Mount thay ZIP qua tunnel free tier |
