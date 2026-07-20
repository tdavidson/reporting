-- Rename the seeded realized-gain account to reflect that a realization can be a gain OR a
-- loss (a distribution/exit at or below cost isn't a gain). Display-name only — the code
-- (4000), id, subtype (realized_gain), and every posting are untouched, so nothing that keys
-- off the account changes. Scoped to accounts still carrying the exact old default name, so a
-- fund that customised the label is left alone.

update public.chart_of_accounts
set name = 'Realized gain/(loss) on investments'
where code = '4000'
  and name = 'Realized gains';
