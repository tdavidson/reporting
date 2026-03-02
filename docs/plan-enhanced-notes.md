# Enhanced Notes: Unread Tracking, Notes Page, @Mentions, Email Notifications

## Context

The notes system currently supports creating, editing, and deleting notes on company pages and the dashboard, but lacks collaboration features. This change adds unread tracking with sidebar badges, a dedicated `/notes` page, @mention parsing with highlighted rendering, email notifications via the existing outbound email infrastructure, and per-user notification preferences.

---

## Files Summary

| File | Action |
|------|--------|
| `supabase/migrations/20260303000001_notes_enhancements.sql` | NEW — `note_reads` table, `note_notification_preferences` table, `note_company_subscriptions` table, `mentioned_user_ids` column on `company_notes`, `count_unread_notes` RPC |
| `lib/types/database.ts` | MODIFY — add types for 3 new tables, add `mentioned_user_ids` to `company_notes` |
| `lib/notes/mentions.ts` | NEW — `parseMentions(content, members)` utility |
| `lib/notes/notify.ts` | NEW — `sendNoteNotifications()` + email template builder |
| `components/note-content.tsx` | NEW — shared component rendering note text with highlighted @mentions |
| `app/api/notes/route.ts` | NEW — `GET /api/notes` unified listing with filters |
| `app/api/notes/mark-read/route.ts` | NEW — `POST /api/notes/mark-read` bulk mark-as-read |
| `app/(app)/notes/page.tsx` | NEW — dedicated Notes page |
| `app/api/companies/[id]/notes/route.ts` | MODIFY — POST: parse mentions, trigger notifications. GET: return `isRead`, `mentionedUserIds` |
| `app/api/dashboard/notes/route.ts` | MODIFY — POST: parse mentions, trigger notifications. GET: return `isRead`, `mentionedUserIds` |
| `app/api/settings/route.ts` | MODIFY — GET/PATCH: `noteNotificationLevel`, `subscribedCompanyIds` |
| `app/(app)/settings/page.tsx` | MODIFY — add `NotificationPreferencesSection` under ProfileSection |
| `app/(app)/layout.tsx` | MODIFY — compute unread notes count, pass as `notesBadge` |
| `components/app-shell.tsx` | MODIFY — add `notesBadge` prop, thread through |
| `components/app-header.tsx` | MODIFY — add `notesBadge` prop, pass to mobile sidebar |
| `components/app-sidebar.tsx` | MODIFY — add Notes nav item with `StickyNote` icon + `badgeKey: 'notes'` |
| `app/(app)/companies/[id]/company-notes.tsx` | MODIFY — use `NoteContent`, call mark-read on open, show unread dot |
| `app/(app)/dashboard/dashboard-notes.tsx` | MODIFY — use `NoteContent`, call mark-read on open, show unread dot |

---

## 1. Database Migration

**File:** `supabase/migrations/20260303000001_notes_enhancements.sql`

```sql
-- Per-note read receipts (needed for per-note @mention unread granularity)
CREATE TABLE note_reads (
  user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  note_id  uuid NOT NULL REFERENCES company_notes(id) ON DELETE CASCADE,
  read_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, note_id)
);
ALTER TABLE note_reads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own reads" ON note_reads FOR ALL USING (user_id = auth.uid());
CREATE INDEX idx_note_reads_user ON note_reads(user_id);

-- Per-user notification preferences
CREATE TABLE note_notification_preferences (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  fund_id    uuid NOT NULL REFERENCES funds(id) ON DELETE CASCADE,
  level      text NOT NULL DEFAULT 'mentions' CHECK (level IN ('all', 'mentions', 'none')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, fund_id)
);
ALTER TABLE note_notification_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own prefs" ON note_notification_preferences FOR ALL USING (user_id = auth.uid());

-- Per-company subscription overrides (notify for all notes on these companies)
CREATE TABLE note_company_subscriptions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  fund_id    uuid NOT NULL REFERENCES funds(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, company_id)
);
ALTER TABLE note_company_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own subs" ON note_company_subscriptions FOR ALL USING (user_id = auth.uid());

-- Denormalized mention tracking on notes
ALTER TABLE company_notes ADD COLUMN mentioned_user_ids uuid[] DEFAULT '{}';
CREATE INDEX idx_company_notes_mentions ON company_notes USING gin(mentioned_user_ids);

-- Efficient unread count RPC for sidebar badge
CREATE OR REPLACE FUNCTION count_unread_notes(p_user_id uuid)
RETURNS bigint LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT count(*)
  FROM company_notes cn
  WHERE cn.fund_id IN (SELECT fund_id FROM fund_members WHERE user_id = p_user_id)
    AND cn.user_id != p_user_id
    AND NOT EXISTS (
      SELECT 1 FROM note_reads nr WHERE nr.note_id = cn.id AND nr.user_id = p_user_id
    );
$$;
```

**Why per-note reads over per-scope timestamps:** @mentions require knowing which specific notes a user has/hasn't seen. A timestamp approach would mark all notes as read when any panel opens.

## 2. TypeScript Types

**Modify:** `lib/types/database.ts`

- Add `note_reads` table type (Row: `user_id`, `note_id`, `read_at`)
- Add `note_notification_preferences` table type (Row: `id`, `user_id`, `fund_id`, `level`, `created_at`, `updated_at`)
- Add `note_company_subscriptions` table type (Row: `id`, `user_id`, `company_id`, `fund_id`, `created_at`)
- Add `mentioned_user_ids: string[]` to `company_notes` Row/Insert/Update

## 3. @Mentions Parsing

**New file:** `lib/notes/mentions.ts`

```ts
export function parseMentions(
  content: string,
  members: Array<{ user_id: string; display_name: string | null }>
): string[]
```

- Builds map of lowercase display names → user IDs
- Sorts names longest-first to match greedily
- Regex: `@(Name1|Name2|...)` case-insensitive
- Returns deduplicated array of matched user IDs

## 4. Email Notifications

**New file:** `lib/notes/notify.ts`

```ts
export async function sendNoteNotifications(
  admin: SupabaseClient,
  fundId: string,
  note: { id: string; content: string; companyId: string | null; companyName: string | null;
          authorName: string; authorUserId: string; mentionedUserIds: string[] }
): Promise<void>
```

**Recipient logic:**
1. Fetch all fund members + their notification preferences
2. If company note, also fetch company subscriptions
3. For each member (excluding author):
   - `level = 'none'` → skip
   - `level = 'all'` → send
   - `level = 'mentions'` (default when no pref row) → send only if @mentioned
   - Has company subscription for this note's company → send
4. Look up email for each recipient via `admin.auth.admin.getUserById()`
5. Fire-and-forget `sendOutboundEmail()` (reuse `getOutboundConfig(admin, fundId, 'system')` from `lib/email.ts`)

**Email template:**
- Subject: `New note from {authorName}` (+ `on {companyName}` if applicable)
- Body: blockquote with note content, link to `/notes`, manage preferences link to `/settings`
- Footer explains why they received it ("You're subscribed to all notes" / "You were mentioned" / "You follow {companyName}")

## 5. Note Content Rendering

**New file:** `components/note-content.tsx`

Shared component replacing raw `<p>{content}</p>` in both note panels:
- Parses `@DisplayName` patterns in content
- Renders mentions as `<span className="text-blue-600 dark:text-blue-400 font-medium">@Name</span>`
- Handles line breaks with `whitespace-pre-wrap`
- Used by company-notes, dashboard-notes, and the new notes page

## 6. Notes Page

**New file:** `app/(app)/notes/page.tsx`

- Full-page view of all notes across the fund, newest first
- Filter bar: Company dropdown, Author dropdown, "Unread only" toggle
- Each note card shows: author name, company badge (if applicable), relative time, unread dot
- Clicking a company badge links to `/companies/{id}`
- On mount, marks visible notes as read via `POST /api/notes/mark-read`

**New file:** `app/api/notes/route.ts` — GET endpoint

- Query params: `companyId`, `authorId`, `unreadOnly`, `page`
- Joins with `note_reads` to compute `isRead` per note
- Returns: `{ notes: NoteRow[], total: number }`

## 7. Mark-as-Read API

**New file:** `app/api/notes/mark-read/route.ts` — POST endpoint

- Body: `{ noteIds: string[] }`
- Upserts into `note_reads` for the authenticated user
- Called when notes panel opens (company/dashboard) and when notes page loads

## 8. Sidebar Badge

**Modify:** `app/(app)/layout.tsx`
- Call `supabase.rpc('count_unread_notes', { p_user_id: user.id })` to get unread count
- Pass as `notesBadge` to `AppShell`

**Modify:** `components/app-shell.tsx` → `components/app-header.tsx` → `components/app-sidebar.tsx`
- Thread `notesBadge: number` prop through the chain (same pattern as `reviewBadge`/`settingsBadge`)

**Modify:** `components/app-sidebar.tsx`
- Add nav item: `{ href: '/notes', label: 'Notes', icon: StickyNote, badgeKey: 'notes' }`
- Position after Portfolio, before Review
- Extend `badgeKey` type to `'review' | 'settings' | 'notes'`
- Add `notesBadge` to `AppSidebarProps`

## 9. Notification Preferences in Settings

**Modify:** `app/api/settings/route.ts`
- GET: query `note_notification_preferences` + `note_company_subscriptions` for the user, return `noteNotificationLevel` (default `'mentions'`) and `subscribedCompanyIds: string[]`
- PATCH: accept `noteNotificationLevel` ('all' | 'mentions' | 'none') → upsert into `note_notification_preferences`. Accept `subscribedCompanyIds` → delete all existing + insert new rows into `note_company_subscriptions`

**Modify:** `app/(app)/settings/page.tsx`
- Add `noteNotificationLevel` and `subscribedCompanyIds` to `Settings` interface
- Add `NotificationPreferencesSection` below `ProfileSection` (available to all users):
  - Radio group: All / @Mentions only / None
  - Company subscription chips with add/remove (dropdown of portfolio companies)
  - Saves via `PATCH /api/settings`

## 10. Existing Notes Panel Updates

**Modify:** `app/(app)/companies/[id]/company-notes.tsx`
- Replace `<p>{note.content}</p>` with `<NoteContent content={note.content} />`
- On panel open, POST to `/api/notes/mark-read` with all visible note IDs
- Show blue dot on unread notes
- Show unread count on the ChatButton toggle

**Modify:** `app/(app)/dashboard/dashboard-notes.tsx`
- Same changes as company notes

**Modify:** `app/api/companies/[id]/notes/route.ts`
- GET: LEFT JOIN `note_reads` to add `isRead` boolean to each note response
- POST: After insert, call `parseMentions()` → store `mentioned_user_ids` → call `sendNoteNotifications()` fire-and-forget

**Modify:** `app/api/dashboard/notes/route.ts`
- Same GET/POST changes as company notes route

---

## Implementation Order

1. Migration + TypeScript types
2. `lib/notes/mentions.ts` (parsing utility)
3. `components/note-content.tsx` (rendering component)
4. Modify company notes + dashboard notes API routes (POST: mentions, GET: isRead)
5. `app/api/notes/mark-read/route.ts`
6. Modify company-notes.tsx + dashboard-notes.tsx (NoteContent, mark-read, unread dots)
7. Sidebar badge: layout.tsx → app-shell.tsx → app-header.tsx → app-sidebar.tsx
8. `app/api/notes/route.ts` + `app/(app)/notes/page.tsx` (notes page)
9. `lib/notes/notify.ts` (email notifications)
10. Wire notifications into POST handlers
11. Settings API + UI for notification preferences

## Verification

1. `npx tsc --noEmit` passes
2. `npm run build` succeeds
3. Notes page: `/notes` loads, filters work, notes display with company badges
4. @mentions: typing `@DisplayName` in a note highlights it after save
5. Unread tracking: new notes from other users show as unread; opening panel marks them read
6. Sidebar badge: shows unread count, clears when notes are viewed
7. Email notifications: creating a note sends email to subscribed users
8. Preferences: changing notification level in settings affects which emails are received
9. Company subscriptions: subscribing to a company sends emails for that company's notes
10. Existing note create/edit/delete flows still work unchanged
