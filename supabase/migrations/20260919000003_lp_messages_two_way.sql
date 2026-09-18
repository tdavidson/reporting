-- Messages in both directions, threaded.
--
-- lp_messages recorded what an LP wrote from their portal's Contact form and nothing else: the
-- GP's reply went out by hand from a mail client, if it went at all, and an announcement to every
-- LP had no home. A message now has a direction and, for a reply, the message it answers. An
-- outbound row is written for a GP's reply (one per thread) and for an announcement (one per
-- investor it went to), so the LP's portal shows the conversation and the GP's inbox shows what
-- was said back.
--
-- The email itself is logged in lp_deliveries like every other send; this table is the content.
alter table public.lp_messages
  add column if not exists direction text not null default 'inbound' check (direction in ('inbound', 'outbound')),
  -- The inbound message this outbound one answers. Null on an announcement and on every LP message.
  add column if not exists parent_id uuid references public.lp_messages(id) on delete set null,
  -- Who at the fund wrote an outbound message.
  add column if not exists sent_by uuid,
  -- For an announcement: the same text went to many investors; this groups the rows.
  add column if not exists announcement_id uuid;

create index if not exists lp_messages_parent_idx on public.lp_messages (parent_id) where parent_id is not null;
create index if not exists lp_messages_investor_idx on public.lp_messages (fund_id, lp_investor_id, created_at desc);

-- A reply resolves the thread it answers; the check stays as it was.
comment on column public.lp_messages.direction is
  'inbound = an LP wrote it from the portal; outbound = the fund wrote it (a reply, parent_id set, or an announcement, announcement_id set).';
