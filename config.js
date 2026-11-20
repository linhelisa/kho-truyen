// Điền 2 giá trị này từ Supabase Dashboard → Project Settings → API.
// Đây là khoá "anon public": được phép để công khai trong trang web,
// dữ liệu vẫn được bảo vệ bằng phân quyền (RLS) trong supabase/schema.sql.
// TUYỆT ĐỐI không dán khoá "service_role" vào đây.
window.KHO_CONFIG = {
  SUPABASE_URL: 'https://kouklbgjtnbxvbejqsvf.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvdWtsYmdqdG5ieHZiZWpxc3ZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUxNzcwODUsImV4cCI6MjExMDc1MzA4NX0.LtmdbJB_jRDbRWKKkDYkSN4yFAvS-5auQh9RGPV95o4',
  MIN_STOCK: 5,           // tồn kho dưới số này thì hiện dấu "Cạn kho"
};
