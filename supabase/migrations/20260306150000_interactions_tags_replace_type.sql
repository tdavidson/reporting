-- Replace interactions.type with tags text[] and drop topics column

-- Step 1: Add tags column
ALTER TABLE interactions ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';

-- Step 2: Backfill tags from existing type values
UPDATE interactions SET tags = '{intro}' WHERE type = 'intro';
UPDATE interactions SET tags = '{}' WHERE type = 'email';

-- Step 3: Delete reporting rows (noise — metrics already handled by pipeline)
DELETE FROM interactions WHERE type = 'reporting';

-- Step 4: Drop type column and its check constraint
ALTER TABLE interactions DROP CONSTRAINT IF EXISTS interactions_type_check;
ALTER TABLE interactions DROP COLUMN IF EXISTS type;

-- Step 5: Drop topics column (superseded by tags)
ALTER TABLE interactions DROP COLUMN IF EXISTS topics;
