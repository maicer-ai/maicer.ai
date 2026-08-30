create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  created_at timestamptz not null default now(),
  constraint waitlist_email_format check (email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  constraint waitlist_email_unique unique (email)
);

alter table public.waitlist enable row level security;

grant insert on table public.waitlist to anon, authenticated;

drop policy if exists "Allow public waitlist signups" on public.waitlist;
create policy "Allow public waitlist signups"
  on public.waitlist
  for insert
  to anon, authenticated
  with check (true);