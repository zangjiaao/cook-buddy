-- Per-user copies of the IndexedDB stores.
-- payload is the record JSON. updated_at + deleted_at drive last-write-wins.

create table ingredients (
  user_id text not null,
  id text not null,
  updated_at text not null,
  deleted_at text,
  payload text not null,
  primary key (user_id, id)
);
create index ingredients_user_idx on ingredients (user_id);

create table inventory_items (
  user_id text not null,
  id text not null,
  updated_at text not null,
  deleted_at text,
  payload text not null,
  primary key (user_id, id)
);
create index inventory_items_user_idx on inventory_items (user_id);

create table recipes (
  user_id text not null,
  id text not null,
  updated_at text not null,
  deleted_at text,
  payload text not null,
  primary key (user_id, id)
);
create index recipes_user_idx on recipes (user_id);

create table recipe_items (
  user_id text not null,
  id text not null,
  updated_at text not null,
  deleted_at text,
  payload text not null,
  primary key (user_id, id)
);
create index recipe_items_user_idx on recipe_items (user_id);

create table plan_entries (
  user_id text not null,
  id text not null,
  updated_at text not null,
  deleted_at text,
  payload text not null,
  primary key (user_id, id)
);
create index plan_entries_user_idx on plan_entries (user_id);

create table shopping_items (
  user_id text not null,
  id text not null,
  updated_at text not null,
  deleted_at text,
  payload text not null,
  primary key (user_id, id)
);
create index shopping_items_user_idx on shopping_items (user_id);
