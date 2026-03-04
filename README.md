# Glyph

Write ~40 lines, get a complete backend.

## Setup

```bash
# Requires Node.js 18+
npm install express express-rate-limit zod pg
```

## Use

```bash
# Compile a .glyph file
node compiler/src/cli.js examples/invoice_service.glyph --output-dir ./out

# Set up database
createdb myapp
psql myapp < out/schema.sql

# Copy runtime shims into output
cp runtime/db.js runtime/middleware.js runtime/server.js out/

# Run
DATABASE_URL=postgresql://localhost:5432/myapp node out/server.js
```

## Run tests

```bash
cd compiler
node tests/run_tests.js      # Phase B/C tests
node tests/test_phase_d.js   # Task graph tests
```

## Teach Claude

Paste `CLAUDE_INSTRUCTIONS.md` into a Claude project's instructions.
Then ask Claude to write Glyph and it will.

## Files

```
compiler/src/     Compiler (lexer, parser, 7 code generators)
compiler/tests/   Test suites
runtime/          db.js, middleware.js, server.js (edit these)
examples/         3 example .glyph files
grammar/          Formal PEG grammar
USAGE.md          Full usage guide
CLAUDE_INSTRUCTIONS.md  System prompt for Claude
SUMMARY_FOR_ERIC.md     Technical summary for review
```
