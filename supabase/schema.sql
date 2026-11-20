-- =====================================================================
-- Kho Truyện: bảng dữ liệu + phân quyền (RLS) trên Supabase
-- Cách chạy: Supabase Dashboard → SQL Editor → New query → dán toàn bộ file → Run.
-- Chạy lại nhiều lần cũng không sao.
-- =====================================================================

-- 1. Thành viên: ai được vào app và với vai trò gì --------------------
create table if not exists public.members (
  email      text primary key check (email = lower(email)),
  role       text not null check (role in ('admin', 'editor')),
  added_at   timestamptz not null default now()
);

-- 2. Truyện ------------------------------------------------------------
--    Trạng thái tự suy ra từ air_date:
--      air_date trống          → Chờ Admin duyệt
--      air_date từ hôm nay     → Đã lên lịch
--      air_date đã qua         → Đã lên sóng
create table if not exists public.stories (
  id          bigint generated always as identity primary key,
  title       text not null check (length(trim(title)) > 0),
  drive_url   text not null check (drive_url ~* '^https://'),
  note        text,
  air_date    date,
  uploaded_by text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Chống up trùng: cùng tên (không phân biệt hoa thường) hoặc cùng link Drive
create unique index if not exists stories_title_uniq on public.stories (lower(trim(title)));
create unique index if not exists stories_drive_uniq on public.stories (drive_url);
create index if not exists stories_air_date_idx on public.stories (air_date);

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists stories_touch on public.stories;
create trigger stories_touch before update on public.stories
  for each row execute function public.touch_updated_at();

-- 3. Hàm tra vai trò của người đang đăng nhập -------------------------
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.members
  where email = lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

revoke all on function public.my_role() from public;
grant execute on function public.my_role() to authenticated;

-- 4. Phân quyền --------------------------------------------------------
alter table public.members enable row level security;
alter table public.stories enable row level security;

-- members: ai cũng xem được dòng của mình; Admin xem và sửa tất cả
drop policy if exists members_select on public.members;
create policy members_select on public.members for select to authenticated
  using (email = lower(auth.jwt() ->> 'email') or public.my_role() = 'admin');

drop policy if exists members_admin_write on public.members;
create policy members_admin_write on public.members for all to authenticated
  using (public.my_role() = 'admin')
  with check (public.my_role() = 'admin');

-- stories: thành viên nào cũng xem được toàn bộ kho
drop policy if exists stories_select on public.stories;
create policy stories_select on public.stories for select to authenticated
  using (public.my_role() is not null);

-- Thêm truyện: Admin thoải mái; Biên tập viên chỉ up truyện chưa có lịch, đứng tên chính mình
drop policy if exists stories_insert on public.stories;
create policy stories_insert on public.stories for insert to authenticated
  with check (
    public.my_role() = 'admin'
    or (public.my_role() = 'editor'
        and air_date is null
        and uploaded_by = lower(auth.jwt() ->> 'email'))
  );

-- Sửa: Admin sửa mọi truyện (lên lịch, bỏ lịch…);
--      Biên tập viên chỉ sửa truyện mình up khi truyện còn chờ duyệt, và không được tự lên lịch
drop policy if exists stories_update on public.stories;
create policy stories_update on public.stories for update to authenticated
  using (
    public.my_role() = 'admin'
    or (public.my_role() = 'editor'
        and uploaded_by = lower(auth.jwt() ->> 'email')
        and air_date is null)
  )
  with check (
    public.my_role() = 'admin'
    or (public.my_role() = 'editor'
        and uploaded_by = lower(auth.jwt() ->> 'email')
        and air_date is null)
  );

-- Xoá: Admin xoá mọi truyện; Biên tập viên chỉ xoá truyện mình up khi còn chờ duyệt
drop policy if exists stories_delete on public.stories;
create policy stories_delete on public.stories for delete to authenticated
  using (
    public.my_role() = 'admin'
    or (public.my_role() = 'editor'
        and uploaded_by = lower(auth.jwt() ->> 'email')
        and air_date is null)
  );

-- 5. Realtime: ai up truyện thì màn hình mọi người tự cập nhật --------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'stories'
  ) then
    alter publication supabase_realtime add table public.stories;
  end if;
end $$;

-- 6. Admin đầu tiên ----------------------------------------------------
-- Thay email bên dưới bằng Gmail của cậu, bỏ dấu -- ở đầu dòng rồi chạy.
-- Các thành viên khác thêm trong app, ở tab "Thành viên".
-- insert into public.members (email, role) values ('email-cua-cau@gmail.com', 'admin')
--   on conflict (email) do update set role = 'admin';
