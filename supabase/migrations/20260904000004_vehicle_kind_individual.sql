-- The individual kind: a person investing for their own account, or the single-member LLC they
-- do it through.
--
-- Until now an angel used `direct` or `other` and got a fund's books: partners' capital, a
-- period close that refuses to run without a partner holding a commitment, an opening-balance
-- bootstrap that refuses without LP paid-in, and "No partners yet" on Admin forever. The
-- investment side of those books is right — per-company cost and unrealized, marks, a
-- schedule of investments — and the equity side is wrong, because there is one owner and
-- nothing to allocate.
--
-- Additive: every existing row keeps its kind, and 'individual' becomes sayable. The chart it
-- seeds and the close it gets are in lib/accounting/chart.ts and lib/accounting/close.ts.

alter table public.fund_vehicles
  drop constraint if exists fund_vehicles_kind_check;
alter table public.fund_vehicles
  add constraint fund_vehicles_kind_check
  check (kind in ('fund', 'spv', 'direct', 'associate', 'individual', 'manco', 'other'));

comment on column public.fund_vehicles.kind is
  'fund | spv | direct | associate (a GP entity) | individual (an angel or their single-member LLC) '
  '| manco (the management company) | other. Decides the chart it seeds, the pages it shows, and '
  'whether the close allocates to partners (fund, spv, direct, associate, other) or rolls into '
  'owner''s equity (manco, individual).';
