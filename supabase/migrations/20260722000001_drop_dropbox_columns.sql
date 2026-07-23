-- Drop the Dropbox file-storage columns.
--
-- Dropbox has been removed as a file-storage provider; Google Drive (and "None / database only")
-- are the remaining options. The application code that read/wrote these columns (the OAuth flow,
-- the settings UI, the save-to-storage dispatch) has been removed, so these columns are now dead.
--
-- `file_storage_provider` is deliberately KEPT — it is the shared provider selector still used by
-- Google Drive and the None/database-only default. Only the dropbox_* columns are dropped.

alter table public.fund_settings drop column if exists dropbox_app_key;
alter table public.fund_settings drop column if exists dropbox_app_secret_encrypted;
alter table public.fund_settings drop column if exists dropbox_refresh_token_encrypted;
alter table public.fund_settings drop column if exists dropbox_folder_path;

alter table public.companies drop column if exists dropbox_folder_path;
