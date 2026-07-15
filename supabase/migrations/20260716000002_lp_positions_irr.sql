-- Stored IRR for a tracked LP position.
--
-- DPI / RVPI / TVPI / % funded are pure functions of commitment / called / distributions / NAV,
-- so they are derived on read and never stored. IRR is NOT derivable from a single position — it
-- needs the timing of cash flows. With a full dated history the position deltas imply it, but a
-- vehicle brought over as a single cutover date has no time spread to imply an IRR, and the source
-- statement usually quotes one. So IRR may be pasted or hand-edited and stored here, and read paths
-- PREFER the stored value when present, deriving from the dated deltas only as a fallback.
--
-- No grants block needed: this only adds a column to an existing table (grants are table-level and
-- already in place for lp_positions).

alter table public.lp_positions
  add column if not exists irr numeric;

comment on column public.lp_positions.irr is
  'Reported IRR for this LP as of this date (fraction, e.g. 0.185). Optional; derived from the dated position deltas when absent.';
