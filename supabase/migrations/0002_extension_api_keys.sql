-- OneClickCast — Phase 7b
-- Extension auth via per-user API keys.
--
-- Flow:
--   1. User clicks "Connect extension" on dashboard, calls
--      create_extension_api_key() — gets a one-time plaintext key.
--   2. User pastes key into extension popup.
--   3. Extension stores key in chrome.storage.local.
--   4. Signaling worker resolves key → user_id via
--      resolve_extension_api_key() (service-role only).
--   5. Worker inserts share_sessions row with that user_id.
--   6. Dashboard's RLS lets the user see their own sessions.
--
-- We never store the plaintext — only sha256 hashes — so a database leak
-- can't reveal active keys. Users can revoke + regenerate any time.

-- pgcrypto provides gen_random_bytes() and digest()
create extension if not exists pgcrypto with schema extensions;

create table public.extension_api_keys (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  key_hash text not null unique,
  key_preview text not null,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

create index extension_api_keys_user_id_idx
  on public.extension_api_keys (user_id);

alter table public.extension_api_keys enable row level security;

create policy "ext_keys_select_own"
  on public.extension_api_keys for select
  using (auth.uid() = user_id);

create policy "ext_keys_delete_own"
  on public.extension_api_keys for delete
  using (auth.uid() = user_id);

-- Generate a fresh API key for the calling user.
-- Returns plaintext exactly once; only the sha256 is stored.
create or replace function public.create_extension_api_key()
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  raw_bytes bytea;
  plaintext text;
  preview text;
  hashed text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  raw_bytes := extensions.gen_random_bytes(24);
  plaintext := 'occ_' || translate(encode(raw_bytes, 'base64'), '+/=', '-_');
  preview := substring(plaintext, 1, 12);
  hashed := encode(extensions.digest(plaintext, 'sha256'), 'hex');

  insert into public.extension_api_keys (user_id, key_hash, key_preview)
  values (auth.uid(), hashed, preview);

  return plaintext;
end;
$$;

-- Resolve a plaintext key to its user_id, bumping last_used_at.
-- Intended for service-role callers only (the signaling worker).
-- RLS doesn't apply to service-role, but anon callers can't reach this:
-- we revoke execute from anon/authenticated below.
create or replace function public.resolve_extension_api_key(p_key text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  resolved uuid;
  hashed text;
begin
  if p_key is null or length(p_key) < 8 then
    return null;
  end if;

  hashed := encode(extensions.digest(p_key, 'sha256'), 'hex');

  update public.extension_api_keys
    set last_used_at = now()
    where key_hash = hashed
    returning user_id into resolved;

  return resolved;
end;
$$;

revoke execute on function public.resolve_extension_api_key(text) from public, anon, authenticated;
