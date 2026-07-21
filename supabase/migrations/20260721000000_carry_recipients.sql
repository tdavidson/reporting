-- Multiple carried-interest recipients with a percentage split.
--
-- Until now a vehicle's carry had ONE recipient (vehicle_waterfall_terms.gp_entity_id) and the
-- close credited all accrued carry to that entity. This adds an optional list of recipients,
-- each with a percentage of the carry (the checked pcts sum to 100). When null/empty, the close
-- falls back to gp_entity_id at 100% — so every existing single-GP vehicle is unchanged with no
-- backfill. Shape: [{ "lpEntityId": "<uuid>", "pct": <number> }].
alter table public.vehicle_waterfall_terms
  add column if not exists carry_recipients jsonb;
