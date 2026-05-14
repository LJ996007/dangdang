create table if not exists public.baby_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  client_id text not null,
  type text not null check (
    type in (
      'sleep_start',
      'sleep_end',
      'feed',
      'feed_start',
      'feed_end',
      'poop',
      'pee',
      'weight'
    )
  ),
  weight_kg numeric,
  timestamp timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, client_id)
);

alter table public.baby_events
  add column if not exists weight_kg numeric;

alter table public.baby_events
  drop constraint if exists baby_events_type_check;

alter table public.baby_events
  add constraint baby_events_type_check check (
    type in (
      'sleep_start',
      'sleep_end',
      'feed',
      'feed_start',
      'feed_end',
      'poop',
      'pee',
      'weight'
    )
  );

alter table public.baby_events
  drop constraint if exists baby_events_weight_type_check;

alter table public.baby_events
  add constraint baby_events_weight_type_check check (
    (type = 'weight' and weight_kg is not null and weight_kg > 0)
    or
    (type <> 'weight' and weight_kg is null)
  );

create index if not exists baby_events_user_updated_at_idx
  on public.baby_events (user_id, updated_at);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.baby_events'::regclass
      and conname = 'baby_events_user_id_client_id_key'
  ) then
    alter table public.baby_events
      add constraint baby_events_user_id_client_id_key unique (user_id, client_id);
  end if;
end $$;

alter table public.baby_events enable row level security;

drop policy if exists "Users can view own baby events"
  on public.baby_events;
create policy "Users can view own baby events"
  on public.baby_events for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create own baby events"
  on public.baby_events;
create policy "Users can create own baby events"
  on public.baby_events for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own baby events"
  on public.baby_events;
create policy "Users can update own baby events"
  on public.baby_events for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

notify pgrst, 'reload schema';
