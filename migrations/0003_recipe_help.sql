-- 请人帮改：分享链接存菜谱快照，修改建议按 token 挂在链接上。
-- token 是随机口令。expires_at / closed_at 决定还能不能提交。

create table recipe_share_links (
  token text primary key,
  user_id text not null,
  recipe_id text not null,
  recipe_name text not null,
  snapshot text not null,
  created_at text not null,
  expires_at text not null,
  closed_at text,
  submission_count integer not null default 0
);
create index recipe_share_links_owner_idx
  on recipe_share_links (user_id, recipe_id);

create table recipe_suggestions (
  id text primary key,
  token text not null,
  user_id text not null,
  recipe_id text not null,
  author text not null,
  payload text not null,
  status text not null check (status in ('pending', 'accepted', 'ignored')),
  created_at text not null,
  resolved_at text
);
create index recipe_suggestions_owner_idx
  on recipe_suggestions (user_id, recipe_id, status);
