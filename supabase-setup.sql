-- Supabase で実行するSQL
-- Table Editorの「SQL Editor」に貼り付けて実行してください

create table if not exists news (
  id          bigserial primary key,
  headline    text not null,
  summary     text,
  category    text,
  source      text,
  hours_ago   text,
  fetched_date date not null,
  created_at  timestamptz default now()
);

-- 日付でよく検索するのでインデックスを作成
create index if not exists news_fetched_date_idx on news (fetched_date desc);

-- Row Level Security: 読み取りは誰でもOK、書き込みはService Keyのみ
alter table news enable row level security;

create policy "Public read"
  on news for select
  using (true);

create policy "Service role insert"
  on news for insert
  with check (true);

create policy "Service role delete"
  on news for delete
  using (true);
