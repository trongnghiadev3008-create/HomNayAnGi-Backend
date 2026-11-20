# 🍜 Hôm Nay Ăn Gì? — RESTful API Backend Server

Backend độc lập xây dựng bằng **Node.js + Express + TypeScript + Prisma ORM**, phục vụ ứng dụng Android **"Hôm Nay Ăn Gì?"** và trang Quản trị (Admin).

## ✨ Tính năng chính
- **Database linh hoạt (SQLite / PostgreSQL):** Chạy ngay ở môi trường Dev bằng `SQLite` (`prisma/dev.db`), chuyển sang `PostgreSQL` khi Deploy Production chỉ với 1 dòng cấu hình.
- **Seed dữ liệu tự động:** Nạp sẵn **365 món ăn** từ `foods.json` và khởi tạo tài khoản Admin mặc định (`admin@homnayangi.vn` / `Admin@123`).
- **Bảo mật tiêu chuẩn:** `helmet`, `cors`, `express-rate-limit` (100 req / 15 phút mỗi IP), băm mật khẩu với `bcryptjs` và xác thực phân quyền JWT (`verifyToken`, `requireAdmin`).
- **Gacha Engine trên Server:** Quay thưởng 2 pha theo trọng số độ hiếm (`THƯỜNG` 55%, `HIẾM` 25%, `SỬ THI` 12%, `HUYỀN THOẠI` 6%, `CỔ VẬT` 2%) và tự động lưu `SpinHistory` nếu đã đăng nhập.
- **Chuẩn chính sách Google Play:** Hỗ trợ đồng bộ Firebase Auth (`POST /api/auth/firebase-sync`) và xóa vĩnh viễn tài khoản thật (`DELETE /api/user/account`).

---

## 🚀 Cài đặt & Khởi chạy

```bash
# 1. Cài đặt thư viện
npm install

# 2. Khởi tạo bảng SQLite & Prisma Client
npx prisma db push

# 3. Nạp 365 món ăn & tài khoản Admin
npm run prisma:seed

# 4. Chạy server ở cổng 4000
npm run dev
```

Server mặc định chạy tại: `http://localhost:4000`
- Tài khoản Admin mặc định: `admin@homnayangi.vn` / `Admin@123`

---

## 📡 Danh sách REST API Endpoints

### 1. Auth (`/api/auth`)
| Method | Endpoint | Quyền | Mô tả |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/register` | Public | Đăng ký tài khoản (`{ email, password, name }`) |
| `POST` | `/api/auth/login` | Public | Đăng nhập nhận JWT (`{ email, password }`) |
| `POST` | `/api/auth/firebase-sync` | Public | Đồng bộ user từ Firebase Auth Android (`{ firebaseUid, email, name }`) |

### 2. Foods (`/api/foods`)
| Method | Endpoint | Quyền | Mô tả |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/foods` | Public | Lọc theo query: `mainGroup`, `subCategory`, `rarity`, `isVegetarian`, `maxPrice`, `search` |
| `GET` | `/api/foods/:id` | Public | Chi tiết 1 món ăn |
| `POST` | `/api/foods/spin` | Public / User | Quay Gacha theo độ hiếm (nếu kèm Bearer Token sẽ lưu vào `SpinHistory`) |
| `POST` | `/api/foods` | `ADMIN` | Thêm món ăn mới |
| `PUT` | `/api/foods/:id` | `ADMIN` | Cập nhật món ăn |
| `DELETE` | `/api/foods/:id` | `ADMIN` | Xóa món ăn |

### 3. User Data (`/api/user`)
| Method | Endpoint | Quyền | Mô tả |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/user/profile` | `USER`/`ADMIN` | Hồ sơ cá nhân + danh sách yêu thích + thống kê lượt quay |
| `GET` | `/api/user/favorites` | `USER`/`ADMIN` | Danh sách các món yêu thích |
| `POST` | `/api/user/favorites/:foodId` | `USER`/`ADMIN` | Toggle thêm/bỏ yêu thích món ăn |
| `GET` | `/api/user/history` | `USER`/`ADMIN` | Lịch sử quay Gacha của người dùng |
| `DELETE` | `/api/user/account` | `USER`/`ADMIN` | Xóa vĩnh viễn tài khoản & dữ liệu cá nhân (chuẩn CH Play) |

### 4. Admin Stats (`/api/admin`)
| Method | Endpoint | Quyền | Mô tả |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/admin/stats` | `ADMIN` | Tổng số món, thống kê theo nhóm/độ hiếm, tổng người dùng & top món được quay nhiều nhất |
