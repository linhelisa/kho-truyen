# Kho Truyện

App nội bộ theo dõi truyện cho kênh YouTube:

- **Biên tập viên** up truyện đã biên tập xong (tên truyện + link Google Drive + ghi chú).
- **Admin** biên tập lần cuối rồi chọn ngày lên sóng. Qua ngày lên sóng, truyện tự chuyển sang "Đã lên sóng".
- Trên cùng có tồn kho (dưới 5 tập thì hiện dấu "Cạn kho") và số tập đã biên tập trong tháng.
- Ai up hay xếp lịch thì màn hình mọi người tự cập nhật, không cần tải lại.

App là trang tĩnh (HTML + JS), không cần cài Node hay build. Dữ liệu và phân quyền nằm trên Supabase.

| File | Dùng để |
|---|---|
| `index.html`, `styles.css`, `app.js` | Giao diện app |
| `config.js` | Điền địa chỉ và khoá Supabase |
| `supabase/schema.sql` | Tạo bảng và phân quyền trên Supabase |

---

## Cài đặt (làm 1 lần, khoảng 15 phút)

### Bước 1. Tạo project Supabase
1. Vào https://supabase.com → đăng nhập → **New project**. Đặt tên, chọn vùng **Singapore** (gần Việt Nam nhất).
2. Đợi project tạo xong (1–2 phút).

### Bước 2. Tạo bảng và phân quyền
1. Trong project: **SQL Editor** → **New query**.
2. Mở file `supabase/schema.sql`, dán toàn bộ vào, bấm **Run**.
3. Thêm chính cậu làm Admin: chạy câu sau (thay bằng Gmail của cậu):
   ```sql
   insert into public.members (email, role) values ('email-cua-cau@gmail.com', 'admin');
   ```

### Bước 3. Điền `config.js`
1. Supabase → **Project Settings** → **API**.
2. Copy **Project URL** dán vào `SUPABASE_URL`.
3. Copy khoá **anon public** dán vào `SUPABASE_ANON_KEY`.

Khoá *anon* được phép để công khai trong trang web, dữ liệu vẫn được phân quyền bảo vệ. **Không bao giờ** dán khoá *service_role* vào đây.

### Bước 4. Đưa app lên mạng
Cách dễ nhất là **Netlify Drop**:
1. Vào https://app.netlify.com/drop.
2. Kéo cả thư mục `kho-truyen` thả vào trang đó.
3. Netlify cho một link dạng `https://ten-gi-do.netlify.app`. Đó là link app.

Muốn tự cập nhật mỗi khi sửa code thì dùng Vercel hoặc Netlify nối với GitHub, chọn thư mục gốc (Root directory) là `kho-truyen`.

### Bước 5. Cho Supabase biết link app (để link đăng nhập trong email mở đúng app)
Supabase → **Authentication** → **URL Configuration**:
- **Site URL**: dán link app ở bước 4.
- **Redirect URLs**: bấm *Add URL*, dán link app thêm một lần nữa.

Xong. Mở link app, nhập Gmail của cậu, bấm link trong email là vào với vai trò Admin.

---

## Phân quyền

Có 2 vai trò, gắn theo email:

| Việc | Biên tập viên | Admin |
|---|:-:|:-:|
| Xem kho, lịch, số liệu | ✅ | ✅ |
| Up truyện mới | ✅ | ✅ |
| Xoá truyện **mình up** khi còn chờ duyệt | ✅ | ✅ |
| Lên lịch / bỏ lịch / kéo-thả trên lịch | ❌ | ✅ |
| Xoá bất kỳ truyện nào | ❌ | ✅ |
| Thêm / xoá / đổi vai trò thành viên | ❌ | ✅ |

Quyền được khoá **trong cơ sở dữ liệu** (RLS). Dù ai đó có link app hay mở công cụ lập trình của trình duyệt, họ cũng không làm được việc ngoài quyền của mình. Email không có trong danh sách thì đăng nhập vào chỉ thấy thông báo "Chưa có quyền".

### Thêm biên tập viên
1. Admin mở app → tab **Thành viên**.
2. Nhập Gmail của biên tập viên, chọn **Biên tập viên**, bấm **Thêm**.
3. Gửi họ link app. Họ nhập email, mở hộp thư, bấm link đăng nhập là vào. Trình duyệt sẽ nhớ đăng nhập, lần sau mở là vào thẳng.

### Cho ai đó nghỉ
Tab **Thành viên** → **Xoá** (bấm 2 lần để chắc chắn). Từ lần tải trang tiếp theo, họ không xem hay sửa được gì nữa.

### Quyền mở file kịch bản
App chỉ lưu link, còn quyền mở file vẫn do **Google Drive** quyết định. Nên tạo một thư mục Drive chung, chia sẻ cho cả team, và để mọi kịch bản trong đó.

---

## Lưu ý
- **Email đăng nhập:** Supabase gói miễn phí chỉ gửi vài email đăng nhập mỗi giờ. Với 3–4 người thì đủ, vì trình duyệt nhớ đăng nhập rất lâu. Nếu gặp lỗi "Gửi quá nhiều lần", đợi khoảng 1 giờ rồi thử lại.
- **Chống trùng:** truyện trùng tên (kể cả gõ không dấu) hoặc trùng link Drive sẽ không up được.
- **Tự chuyển "Đã lên sóng":** app tính theo ngày. Nếu một ngày lỡ chưa đăng video, Admin vào lịch đổi sang ngày khác.
- **Gói miễn phí Supabase** tạm dừng project nếu 7 ngày liền không ai dùng. Vào dashboard bấm *Restore* là chạy lại, dữ liệu vẫn còn.
