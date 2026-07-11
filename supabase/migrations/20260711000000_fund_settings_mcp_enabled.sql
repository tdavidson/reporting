-- MCP server settings. All off by default: a deployed platform exposes no MCP
-- surface until an admin explicitly turns it on in Settings.
--
--   mcp_enabled      — master switch. When off, /api/mcp rejects every request
--                      even with a valid fund API key. When on, the server
--                      exposes a READ-ONLY tool surface.
--   mcp_write_scopes — per-capability write opt-ins, e.g.
--                      {"notes": true, "ledger": true}. Read-only is the
--                      default; an admin enables specific writable capabilities
--                      one at a time. A write tool runs only when its category
--                      is true here AND the caller is an admin AND the key was
--                      minted with the write scope. Categories with no entry (or
--                      false) stay read-only. Ignored when mcp_enabled is off.
--
-- Mirrors the existing capability flags (deal_intake_enabled, lp_portal_enabled)
-- rather than the feature_visibility map, which only governs in-app navigation.
alter table fund_settings
  add column if not exists mcp_enabled boolean not null default false,
  add column if not exists mcp_write_scopes jsonb not null default '{}'::jsonb;
