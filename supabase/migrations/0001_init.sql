-- OneClickCast initial schema
-- Run via: supabase db reset, or paste into the Supabase SQL editor.

create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
-- Extends auth.users with our application-level fields. One row per Supabase
-- user, kept in sync via the on_auth_user_created trigger below.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Auto-create profile when a new user signs up. SECURITY DEFINER lets the
-- trigger insert into public.profiles even though the caller is the new user.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Share sessions
-- ---------------------------------------------------------------------------
-- One row per "Start sharing" session. Written by the signaling worker (via
-- service-role key) once the room is created and updated when it ends.

create table public.share_sessions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.profiles(id) on delete set null,
  room_id text not null unique,
  mode text check (mode in ('any', 'tab')),
  shared_tab_title text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_sec int,
  peak_viewer_count int not null default 0,
  total_viewer_joins int not null default 0,
  was_recorded boolean not null default false,
  remote_control_used boolean not null default false,
  created_at timestamptz not null default now()
);

create index share_sessions_user_started_idx
  on public.share_sessions (user_id, started_at desc);

alter table public.share_sessions enable row level security;

create policy "sessions_select_own"
  on public.share_sessions for select
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Recordings (Phase 6b stub - rows added once cloud upload is wired up)
-- ---------------------------------------------------------------------------

create table public.recordings (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  session_id uuid references public.share_sessions(id) on delete set null,
  storage_key text not null,
  filename text not null,
  size_bytes bigint not null,
  duration_sec int,
  mime_type text not null default 'video/webm',
  status text not null default 'uploaded'
    check (status in ('uploading', 'uploaded', 'transcoded', 'failed')),
  created_at timestamptz not null default now()
);

create index recordings_user_created_idx
  on public.recordings (user_id, created_at desc);

alter table public.recordings enable row level security;

create policy "recordings_select_own"
  on public.recordings for select
  using (auth.uid() = user_id);

create policy "recordings_delete_own"
  on public.recordings for delete
  using (auth.uid() = user_id);
