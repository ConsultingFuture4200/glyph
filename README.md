# Glyph

Write ~40 lines, get a complete backend.

## What

Glyph is a declarative language for defining backend services. A single `.glyph` file compiles to TypeScript types, Zod validators, Postgres DDL, Express routes, and guardrail configs — replacing 8-12 files of handwritten boilerplate.

```
model Invoice [confidential, owned by customer]
  id: uuid key
  customer: -> Customer
  amount: Money
  status: draft | sent | paid | void = draft
  created: timestamp = now
```

That model definition generates a TypeScript interface, a Zod schema with Create/Update variants, a Postgres table with RLS policies and audit logging, foreign key constraints, CHECK constraints, and an `updated_at` trigger. Six lines.

## Why

**For humans**: Backend services are 80% boilerplate. Types, validations, schemas, routes, auth middleware, rate limits, state machines, business rules — the same patterns repeated across every project. Glyph captures the intent in ~40 lines and generates the rest.

**For AI agents**: LLMs burn context windows passing around thousands of tokens of TypeScript, SQL, and Express code between agents. Glyph compresses that to ~625 tokens — a 92% reduction. Agents read and write Glyph as their shared protocol, and the compiler expands it to running code. The project includes tier-specific system prompts for strategist, architect, executor, reviewer, and utility agents, plus scoped context profiles so each agent only loads what it needs.

## How

Glyph compiles through a pipeline: **Lexer** (tokenization with indentation tracking) → **Parser** (recursive descent to AST) → **Conventions** (smart defaults — auto-IDs, auth, rate limits, deny-by-default) → **7 Code Generators** (types, SQL, routes, guards, rules, pipelines, task graphs).

The language has 8 block types that cover the full backend surface:

| Block | Purpose | Generates |
|---|---|---|
| `type` | Named constraints on base types | Zod schemas, TS aliases |
| `model` | Data definitions with classification | Tables, RLS, audit logs, interfaces |
| `transition` | State machines, deny by default | Transition tables, guard functions |
| `service` | CRUD endpoints with modifiers | Express routers, middleware |
| `rules` | Declarative business constraints | SQL triggers, Express middleware |
| `guard` | Per-service guardrails (required) | Runtime config JSON |
| `pipeline` | Event-driven step chains | Async handlers with retry/rollback |
| `task` | Work items for agent orchestration | Dependency graphs, context profiles |

Every service requires a co-located guard block — the compiler enforces this. Transitions must end with `_ -> _: deny`. Fields are required by default. These constraints are opinionated by design: they eliminate entire categories of security and correctness bugs at the language level.

---

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
compiler/src/         Compiler (lexer, parser, 7 code generators)
compiler/tests/       Test suites (113 passing)
runtime/              db.js, middleware.js, server.js (edit these)
examples/             4 example .glyph files
grammar/              Formal PEG grammar
CLAUDE.md             Language reference for Claude
USAGE.md              Full usage guide
AGENT_WALKTHROUGH.md  End-to-end multi-agent build example
```
