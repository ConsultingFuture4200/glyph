#!/usr/bin/env node
// ===========================================================================
// Glyph Compiler — CLI
// Usage: node src/cli.js <input.glyph> [options]
//        node src/cli.js decompile <input.glyph>
//        node src/cli.js prompts [--tier <tier>] [--output-dir <dir>]
// ===========================================================================

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { compile } from './index.js';
import { decompile } from './decompiler.js';
import { getAgentPrompt, getAllPrompts, estimatePromptTokens } from './agent_prompts.js';

const args = process.argv.slice(2);

if (args.length === 0 || args.includes('--help')) {
  console.log(`
glyphc — Glyph Compiler v0.1.0

Commands:
  glyphc <input.glyph> [options]   Compile a .glyph file
  glyphc decompile <input.glyph>   Decompile back to Glyph source (round-trip test)
  glyphc prompts [options]         Generate agent system prompt templates

Compile options:
  --output-dir <dir>   Output directory (default: ./output)
  --skip-guard-check   Don't enforce guard co-location
  --ast-only           Only parse, don't generate code

Prompts options:
  --tier <tier>        Generate for one tier (strategist|architect|executor|reviewer|utility)
  --output-dir <dir>   Write prompt files to directory

Output files:
  types.ts             TypeScript types + Zod validators
  schema.sql           PostgreSQL DDL
  routes.ts            Express routes + middleware
  guards.json          Guardrail configs
  work_items.json      Task graph records
  context_profiles.json  Per-block context budgets
`);
  process.exit(0);
}

// --- DECOMPILE command ---
if (args[0] === 'decompile') {
  const inputFile = args[1];
  if (!inputFile) { console.error('Usage: glyphc decompile <input.glyph>'); process.exit(1); }
  const source = readFileSync(inputFile, 'utf-8');
  const result = compile(source, { skipGuardCheck: true });
  const roundTripped = decompile(result.ast);
  console.log(roundTripped);
  process.exit(0);
}

// --- PROMPTS command ---
if (args[0] === 'prompts') {
  const tierIdx = args.indexOf('--tier');
  const outputDirIdx = args.indexOf('--output-dir');
  const outputDir = outputDirIdx >= 0 ? args[outputDirIdx + 1] : null;

  if (tierIdx >= 0) {
    const tier = args[tierIdx + 1];
    const prompt = getAgentPrompt(tier);
    const tokens = estimatePromptTokens(tier);
    if (outputDir) {
      if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
      writeFileSync(join(outputDir, `prompt_${tier}.md`), prompt);
      console.log(`Wrote ${tier} prompt (~${tokens} tokens) to ${outputDir}/prompt_${tier}.md`);
    } else {
      console.log(prompt);
      console.log(`\n--- (~${tokens} tokens) ---`);
    }
  } else {
    const prompts = getAllPrompts();
    if (outputDir) {
      if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
      for (const [tier, prompt] of Object.entries(prompts)) {
        const tokens = estimatePromptTokens(tier);
        writeFileSync(join(outputDir, `prompt_${tier}.md`), prompt);
        console.log(`  ${tier}: ~${tokens} tokens → ${outputDir}/prompt_${tier}.md`);
      }
    } else {
      for (const [tier, prompt] of Object.entries(prompts)) {
        const tokens = estimatePromptTokens(tier);
        console.log(`${tier}: ~${tokens} tokens`);
      }
    }
  }
  process.exit(0);
}

const inputFile = args[0];
const outputDirIdx = args.indexOf('--output-dir');
const outputDir = outputDirIdx >= 0 ? args[outputDirIdx + 1] : './output';
const skipGuardCheck = args.includes('--skip-guard-check');
const astOnly = args.includes('--ast-only');

try {
  const source = readFileSync(inputFile, 'utf-8');
  const baseName = basename(inputFile, '.glyph');

  console.log(`Compiling ${inputFile}...`);

  const result = compile(source, { skipGuardCheck });

  if (astOnly) {
    console.log(JSON.stringify(result.ast, null, 2));
    process.exit(0);
  }

  // Write outputs
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  writeFileSync(join(outputDir, 'types.ts'), result.types);
  writeFileSync(join(outputDir, 'schema.sql'), result.sql);
  writeFileSync(join(outputDir, 'routes.ts'), result.routes);
  writeFileSync(join(outputDir, 'guards.json'), result.guards);

  if (result.rulesMiddleware) {
    writeFileSync(join(outputDir, 'rules.ts'), result.rulesMiddleware);
  }
  if (result.pipelines) {
    writeFileSync(join(outputDir, 'pipelines.ts'), result.pipelines);
  }

  // Phase D: Task graph outputs
  if (result.taskGraph) {
    writeFileSync(join(outputDir, 'work_items.sql'), result.taskGraph.sql);
    writeFileSync(join(outputDir, 'work_items.json'), result.taskGraph.json);
  }
  if (result.contextProfiles) {
    writeFileSync(join(outputDir, 'context_profiles.json'), JSON.stringify(result.contextProfiles, null, 2));
  }

  // Write escape blocks
  result.escapeBlocks.forEach((block, i) => {
    writeFileSync(join(outputDir, `escape_${i}.ts`), block);
  });

  console.log(`\n✓ Compiled successfully in ${result.stats.duration}ms`);
  console.log(`  Blocks: ${result.stats.blockCount}`);
  console.log(`  Tokens: ${result.stats.tokenCount}`);
  console.log(`  Work items: ${result.stats.workItemCount || 0}`);
  console.log(`  Context profiles: ${result.stats.contextProfileCount || 0}`);
  console.log(`  Escape blocks: ${result.stats.escapeBlockCount}`);
  console.log(`  Escape hatch ratio: ${(result.stats.escapeHatchRatio * 100).toFixed(1)}%`);
  console.log(`\n  Output:`);
  console.log(`    ${outputDir}/types.ts`);
  console.log(`    ${outputDir}/schema.sql`);
  console.log(`    ${outputDir}/routes.ts`);
  console.log(`    ${outputDir}/guards.json`);
  if (result.taskGraph?.workItems.length > 0) {
    console.log(`    ${outputDir}/work_items.sql`);
    console.log(`    ${outputDir}/work_items.json`);
  }
  if (result.contextProfiles) {
    console.log(`    ${outputDir}/context_profiles.json`);
  }
  if (result.escapeBlocks.length > 0) {
    console.log(`    ${outputDir}/escape_*.ts (${result.escapeBlocks.length} files)`);
  }

} catch (err) {
  console.error(`\n✗ ${err.message}`);
  if (err.inner) {
    console.error(`  ${err.inner.message}`);
  }
  process.exit(1);
}
