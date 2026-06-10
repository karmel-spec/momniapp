-- Momni 2.0 — Supabase schema (TestFlight beta v0.1)
-- Run in the Supabase SQL editor. Sacred rules enforced in the schema itself:
--   * No care-payment tables exist, by design. Momni never touches care money.
--   * Background checks are member-uploaded content (shared_items), never Momni verification.
--   * Precise coords are private; only city/neighborhood + jittered coords are exposed publicly.
--   * Legacy 1.0 pins are city-level counts only — no names until a mama claims and re-opts-in.

-- ===== profiles =====
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  photo_url text,
  city text,
  neighborhood text,
  bio text default '',
  kids_ages int[] default '{}',
  role text not null default 'find-care' check (role in ('host','find-care','both')),
  hourly_rate_note text default '',          -- she sets it; paid directly to her
  home_highlights text default '',
  care_types text[] default '{}',            -- right-now, date-night, my-regulars, night-shift, weekend-getaway, extended-trip
  available_now boolean default false,
  -- precise location: PRIVATE (RLS below). public map uses city_lat/lng only.
  precise_lat double precision,
  precise_lng double precision,
  city_lat double precision,
  city_lng double precision,
  signup_acknowledged_at timestamptz,        -- clickwrap #1 (signup) timestamp
  signup_acknowledgment_text text,           -- exact text accepted
  links_balance int not null default 2,      -- free tier: 2 Links/mo
  momni_plus boolean default false,
  circle_up boolean default false,
  gives_toggle boolean default false,
  legacy_claimed boolean default false,      -- claimed her 1.0 pin (fresh opt-in recorded)
  created_at timestamptz default now()
);
alter table public.profiles enable row level security;

create policy "profiles are publicly readable (app handles field filtering via view)"
  on public.profiles for select using (true);
create policy "users update own profile"
  on public.profiles for update using (auth.uid() = id);
create policy "users insert own profile"
  on public.profiles for insert with check (auth.uid() = id);

-- Public-facing view: NEVER exposes precise coords or acknowledgment records.
create view public.profiles_public as
  select id, name, photo_url, city, neighborhood, bio, kids_ages, role,
         hourly_rate_note, home_highlights, care_types, available_now,
         city_lat, city_lng, legacy_claimed, created_at
  from public.profiles;

-- ===== what this mama chose to share (member content, never Momni badges) =====
create table public.shared_items (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('background_check','id_shared','other')),
  label text not null,                       -- e.g. "Background check — purchased and shared by Sarah"
  file_path text,                            -- storage path of the PDF she uploaded (her content)
  obtained_date date,
  created_at timestamptz default now()
);
alter table public.shared_items enable row level security;
create policy "shared items are public" on public.shared_items for select using (true);
create policy "owner manages shared items" on public.shared_items
  for all using (auth.uid() = profile_id) with check (auth.uid() = profile_id);

-- ===== care requests + connections (booking-lite) =====
create table public.care_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  care_type text not null check (care_type in ('right-now','date-night','my-regulars','night-shift','weekend-getaway','extended-trip')),
  details jsonb default '{}',                -- dates, times, weekdays, kids
  broadcast boolean default false,           -- Right Now broadcasts to nearby available mamas
  status text not null default 'open' check (status in ('open','matched','closed','expired')),
  created_at timestamptz default now()
);
alter table public.care_requests enable row level security;
create policy "open requests visible to hosts" on public.care_requests for select using (true);
create policy "requester manages own" on public.care_requests
  for all using (auth.uid() = requester_id) with check (auth.uid() = requester_id);

create table public.connections (              -- a "booking" in beta = confirmed connection
  id uuid primary key default gen_random_uuid(),
  request_id uuid references public.care_requests(id) on delete set null,
  guest_id uuid not null references public.profiles(id) on delete cascade,
  host_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'requested' check (status in ('requested','accepted','declined','completed','cancelled')),
  -- clickwrap #2: recorded verbatim on every FIRST connection between two mamas
  acknowledgment_text text not null,
  acknowledged_at timestamptz not null default now(),
  created_at timestamptz default now(),
  check (guest_id <> host_id)
);
alter table public.connections enable row level security;
create policy "participants see own connections" on public.connections
  for select using (auth.uid() in (guest_id, host_id));
create policy "guest creates connection" on public.connections
  for insert with check (auth.uid() = guest_id);
create policy "participants update status" on public.connections
  for update using (auth.uid() in (guest_id, host_id));

-- ===== messaging (1:1 per connection, Supabase Realtime) =====
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.connections(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text default '',
  photo_path text,
  created_at timestamptz default now()
);
alter table public.messages enable row level security;
create policy "participants read messages" on public.messages for select using (
  exists (select 1 from public.connections c where c.id = connection_id and auth.uid() in (c.guest_id, c.host_id))
);
create policy "participants send messages" on public.messages for insert with check (
  sender_id = auth.uid() and
  exists (select 1 from public.connections c where c.id = connection_id and auth.uid() in (c.guest_id, c.host_id)
          and c.status = 'accepted')
);

-- ===== circles =====
create table public.circles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text,
  lat double precision, lng double precision, -- circle meeting spots are intentionally public
  schedule text default '',
  leader_id uuid references public.profiles(id),
  created_at timestamptz default now()
);
create table public.circle_members (
  circle_id uuid references public.circles(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete cascade,
  joined_at timestamptz default now(),
  primary key (circle_id, profile_id)
);
create table public.circle_posts (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  pinned boolean default false,
  created_at timestamptz default now()
);
create table public.circle_events (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles(id) on delete cascade,
  title text not null,
  starts_at timestamptz not null,
  location text default '',
  created_at timestamptz default now()
);
create table public.event_rsvps (
  event_id uuid references public.circle_events(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete cascade,
  primary key (event_id, profile_id)
);
alter table public.circles enable row level security;
alter table public.circle_members enable row level security;
alter table public.circle_posts enable row level security;
alter table public.circle_events enable row level security;
alter table public.event_rsvps enable row level security;
create policy "circles public" on public.circles for select using (true);
create policy "auth users create circles" on public.circles for insert with check (auth.uid() = leader_id);
create policy "leader updates circle" on public.circles for update using (auth.uid() = leader_id);
create policy "members public" on public.circle_members for select using (true);
create policy "join self" on public.circle_members for insert with check (auth.uid() = profile_id);
create policy "leave self" on public.circle_members for delete using (auth.uid() = profile_id);
create policy "posts visible to members" on public.circle_posts for select using (
  exists (select 1 from public.circle_members m where m.circle_id = circle_posts.circle_id and m.profile_id = auth.uid())
);
create policy "members post" on public.circle_posts for insert with check (
  author_id = auth.uid() and
  exists (select 1 from public.circle_members m where m.circle_id = circle_posts.circle_id and m.profile_id = auth.uid())
);
create policy "leader pins/moderates" on public.circle_posts for update using (
  exists (select 1 from public.circles c where c.id = circle_posts.circle_id and c.leader_id = auth.uid())
);
create policy "events public" on public.circle_events for select using (true);
create policy "leader creates events" on public.circle_events for insert with check (
  exists (select 1 from public.circles c where c.id = circle_id and c.leader_id = auth.uid())
);
create policy "rsvps public" on public.event_rsvps for select using (true);
create policy "rsvp self" on public.event_rsvps for insert with check (auth.uid() = profile_id);
create policy "unrsvp self" on public.event_rsvps for delete using (auth.uid() = profile_id);

-- ===== reviews (community content; "opinions of members") =====
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.connections(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  subject_id uuid not null references public.profiles(id) on delete cascade,
  rating int not null check (rating between 1 and 5),
  body text default '',
  created_at timestamptz default now(),
  unique (connection_id, author_id)
);
alter table public.reviews enable row level security;
create policy "reviews public" on public.reviews for select using (true);
create policy "participant reviews completed connection" on public.reviews for insert with check (
  author_id = auth.uid() and
  exists (select 1 from public.connections c where c.id = connection_id
          and c.status = 'completed' and auth.uid() in (c.guest_id, c.host_id))
);

-- ===== UGC compliance (Apple 1.2): reports + blocks =====
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  subject_type text not null check (subject_type in ('user','post','message','review','profile_photo')),
  subject_id text not null,
  reason text not null check (reason in ('inappropriate','spam','dishonest_profile','harassment','danger_to_children','other')),
  details text default '',
  status text not null default 'open' check (status in ('open','reviewing','actioned','dismissed')),
  created_at timestamptz default now()
);
alter table public.reports enable row level security;
create policy "users file reports" on public.reports for insert with check (auth.uid() = reporter_id);
create policy "reporter sees own reports" on public.reports for select using (auth.uid() = reporter_id);
-- founder dashboard reads via service role (bypasses RLS)

create table public.blocks (
  blocker_id uuid references public.profiles(id) on delete cascade,
  blocked_id uuid references public.profiles(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (blocker_id, blocked_id)
);
alter table public.blocks enable row level security;
create policy "own blocks" on public.blocks for all
  using (auth.uid() = blocker_id) with check (auth.uid() = blocker_id);

-- ===== movement map: legacy pins + waitlist =====
create table public.legacy_pins (                -- anonymized 1.0 clusters: city + count ONLY
  id uuid primary key default gen_random_uuid(),
  city text not null,
  lat double precision not null,
  lng double precision not null,
  count int not null
);
alter table public.legacy_pins enable row level security;
create policy "legacy pins public" on public.legacy_pins for select using (true);

create table public.waitlist_pins (              -- "Bring Momni to my city"
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete set null,
  city text not null,
  lat double precision, lng double precision,
  created_at timestamptz default now()
);
alter table public.waitlist_pins enable row level security;
create policy "waitlist pins public count" on public.waitlist_pins for select using (true);
create policy "drop own pin" on public.waitlist_pins for insert with check (auth.uid() = profile_id);

create table public.pin_claims (                 -- founder-reviewed claim queue (fresh opt-in)
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  claimed_city text not null,
  evidence text default '',                      -- e.g. "I hosted in Houston 2018-2019"
  fresh_opt_in boolean not null default false,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz default now()
);
alter table public.pin_claims enable row level security;
create policy "own claims" on public.pin_claims for all
  using (auth.uid() = profile_id) with check (auth.uid() = profile_id);

-- ===== monthly free-Link refresh (run via pg_cron or scheduled edge function) =====
create or replace function public.refresh_free_links() returns void
language sql security definer as $$
  update public.profiles set links_balance = greatest(links_balance, 2)
  where momni_plus = false;
$$;

-- ===== seed: Utah County circles + legacy clusters =====
insert into public.circles (name, city, lat, lng, schedule) values
  ('Orem Moms Circle','Orem',40.2989,-111.6985,'Tuesdays 10am · Orem City Park'),
  ('Provo Night Shift Mamas','Provo',40.2400,-111.6500,'First Saturdays · rotating homes'),
  ('BYU Married Housing Circle','Provo',40.2520,-111.6360,'Thursdays 4pm · Wymount playground');

insert into public.legacy_pins (city, lat, lng, count) values
  ('Salt Lake City',40.7608,-111.8910,420),
  ('Houston',29.7604,-95.3698,267),
  ('Dallas',32.7767,-96.7970,198),
  ('Atlanta',33.7490,-84.3880,154),
  ('Phoenix',33.4484,-112.0740,96),
  ('Boise',43.6150,-116.2023,52),
  ('St. George',37.0965,-113.5684,61);
