#!/usr/bin/env node
/**
 * Generate TypeScript types from the JSON Schemas in lib/memo-agent/schemas/.
 *
 * Output: lib/memo-agent/types/<name>.ts (one per schema).
 *
 * Run after editing any *.schema.json:
 *     npm run generate:types
 *
 * The generated files are committed; this script is rerun whenever the
 * schemas change. It does not run as part of `next build`.
 */
import { compileFromFile } from 'json-schema-to-typescript'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const SCHEMAS_DIR = path.join(process.cwd(), 'lib/memo-agent/schemas')
const TYPES_DIR = path.join(process.cwd(), 'lib/memo-agent/types')

async function main() {
  await fs.mkdir(TYPES_DIR, { recursive: true })
  const entries = await fs.readdir(SCHEMAS_DIR)
  const schemas = entries.filter(f => f.endsWith('.schema.json'))

  if (schemas.length === 0) {
    console.error('No schemas found in', SCHEMAS_DIR)
    process.exit(1)
  }

  for (const file of schemas) {
    const name = file.replace(/\.schema\.json$/, '')
    const schemaPath = path.join(SCHEMAS_DIR, file)
    const outPath = path.join(TYPES_DIR, `${name}.ts`)
    process.stdout.write(`  generating ${name}.ts ... `)
    const ts = await compileFromFile(schemaPath, {
      bannerComment: `/* eslint-disable */\n/**\n * AUTO-GENERATED FILE — DO NOT EDIT BY HAND.\n * Regenerate with: npm run generate:types\n * Source: lib/memo-agent/schemas/${file}\n */`,
      style: { singleQuote: true, semi: false },
      additionalProperties: false,
    })
    await fs.writeFile(outPath, ts, 'utf8')
    console.log('done')
  }

  // Index file re-exporting all type modules.
  const indexLines = schemas
    .map(f => f.replace(/\.schema\.json$/, ''))
    .map(name => `export * from './${name}'`)
  await fs.writeFile(path.join(TYPES_DIR, 'index.ts'), indexLines.join('\n') + '\n', 'utf8')
  console.log(`  wrote types/index.ts (${schemas.length} modules)`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
