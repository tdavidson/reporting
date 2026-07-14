-- Guard the associates calc against corrupting its own audit trail.
--
-- `lp_investments.input_*` exists to preserve the ORIGINAL imported values before the
-- associates look-through calc overwrites the live columns. The preservation is
-- write-once: `if (existing.input_X == null) input_X := existing.X`.
--
-- The hole: rows the calc *inserts* are born with `input_* = null` (they have no
-- original — they are pure calc output). On a SECOND run, those nulls look exactly like
-- an untouched imported row, so the calc snapshots its own run-1 output into `input_*`.
-- The audit trail then reports calculated figures as if they were the originals, and the
-- real originals are gone. Toggling `associates_calc_enabled` off shows you calc values
-- labelled as imported data.
--
-- This column lets the calc tell its own rows apart from yours. Behaviour is otherwise
-- unchanged: no existing number moves, and rows already in the table default to false,
-- which is the safe reading (treat them as imported — never overwrite their input_*
-- unless they are genuinely still null).

alter table public.lp_investments
  add column if not exists calc_generated boolean not null default false;

comment on column public.lp_investments.calc_generated is
  'True when this row was created by the associates look-through calc rather than imported. '
  'The calc must never snapshot input_* from a calc_generated row — those values are its own '
  'output, not original source data.';
