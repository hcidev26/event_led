# LED Welcome — QR check-in → màn hình LED chào mừng

## Chạy
```
npm install
npm start
```
**Đăng nhập admin** lần đầu: `admin` / `admin123` — vào mục **Tài khoản đăng nhập** trong trang admin để đổi ngay.
(Tuỳ chọn) đặt sẵn tài khoản lần đầu / đổi cổng: `set ADMIN_USER=ten`, `set ADMIN_PASS=matkhau`, `set PORT=8080` trước khi `npm start`.
Quên mật khẩu: tắt server, xoá khối `"auth"` trong `data.json`, chạy lại → về tài khoản mặc định.

## Chạy bằng Docker
```
cp .env.example .env      # sửa PORT, HOST_IP (IP LAN của máy host), tài khoản admin
docker compose up -d --build
```
- Đổi cổng: sửa `PORT=` trong `.env` (ví dụ `PORT=8080`) rồi `docker compose up -d`. Link trong mã QR tự đổi theo.
- **HOST_IP bắt buộc** khi chạy Docker: container không tự biết IP LAN của máy host, nên mã QR cần IP này.
  Có domain/tunnel thì đặt `PUBLIC_URL=https://.../checkin` (hoặc nhập trong admin) thay vì HOST_IP.
- Dữ liệu (`data.json`, ảnh/video tải lên) nằm trong volume `led-data`, không mất khi rebuild/cập nhật.
  Xoá hẳn dữ liệu: `docker compose down -v`.
- Xem log: `docker compose logs -f` · Quên mật khẩu: `docker compose exec led-welcome rm /data/data.json` rồi `docker compose restart`
  (lệnh này xoá luôn cấu hình và danh sách khách).

## 3 trang
| Trang | Dùng cho |
|---|---|
| `http://localhost:3000/admin` | (Cần đăng nhập) Cấu hình nội dung, background, QR, thời gian; xem trước; quản lý danh sách khách |
| `http://localhost:3000/display` | Mở trên máy nối với màn LED → nhấn **F** để toàn màn hình |
| `http://<IP-LAN>:3000/checkin` | Trang khách mở khi quét QR |

## Lưu ý khi chạy sự kiện
- Điện thoại khách phải vào **cùng mạng Wi-Fi** với máy chạy server. Nếu khách dùng 4G, đưa server lên internet
  (VPS, Cloudflare Tunnel, ngrok…) và dán link `https://.../checkin` vào ô **Link check-in** trong admin.
- Windows Firewall có thể hỏi cho phép Node.js — chọn **Allow** (Private network).
- Màn LED 8m × 3m (tỉ lệ 8:3): xuất hình từ máy tính / bộ xử lý LED ở độ phân giải đúng tỉ lệ; layout tự co theo kích thước.
- Ảnh/video nền nên đúng tỉ lệ 8:3 (ví dụ 3840×1440). Video nên là MP4 H.264, chạy lặp, không tiếng.
- Dữ liệu lưu trong `data.json`, file tải lên trong `uploads/`.
