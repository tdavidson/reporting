-- Memo Agent — first-page template exemplar
--
-- Partner feedback: voice was extracted from sample memos but structural /
-- layout elements (especially the first page) were ignored. The fund can now
-- designate one style-anchor memo as the first-page exemplar; the draft stage
-- models the memo's opening on it.

alter table fund_settings
  add column if not exists memo_first_page_anchor_id uuid references style_anchor_memos(id) on delete set null;
