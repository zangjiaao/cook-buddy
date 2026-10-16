-- 分享食谱：链接长期可看、可收藏。allow_suggestions 为 1 时，
-- help_expires_at 之前还能提交修改意见。closed_at 关掉整个链接。

create table recipe_share_links (
  token text primary key,
  user_id text not null,
  recipe_id text not null,
  recipe_name text not null,
  owner_name text not null,
  snapshot text not null,
  created_at text not null,
  allow_suggestions integer not null default 0,
  help_expires_at text,
  closed_at text,
  submission_count integer not null default 0,
  save_count integer not null default 0
);
create index recipe_share_links_owner_idx
  on recipe_share_links (user_id, recipe_id);

create table recipe_share_saves (
  token text not null,
  user_id text not null,
  saved_recipe_id text not null,
  created_at text not null,
  primary key (token, user_id)
);

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
