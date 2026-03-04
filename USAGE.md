# Glyph — Standalone Usage Guide

## What You Have

A compiler that turns `.glyph` files into runnable backends:

```
your_service.glyph  →  glyphc  →  types.ts      (TypeScript + Zod)
                                   schema.sql    (Postgres DDL + RLS)
                                   routes.ts     (Express API)
                                   guards.json   (guardrail configs)
                                   pipelines.ts  (event handlers)
                                   rules.ts      (business rule middleware)
```

One `.glyph` file replaces 8–12 files of TypeScript + Prisma + Express + Zod.

---

## Quick Start

### 1. Set up the project

```bash
mkdir my-service && cd my-service
npm init -y
npm install express express-rate-limit zod pg
```

Copy the compiler directory somewhere accessible:
```bash
cp -r glyph/compiler ~/glyph-compiler
```

### 2. Write your service

Create `app.glyph`:

```
type Email: text ~ email

model User [internal]
  id: uuid key
  name: text 1..100
  email: Email unique
  role: admin | member = member
  created: timestamp = now

model Post [internal, owned by user]
  id: uuid key
  author: -> User
  title: text 1..200
  body: text
  status: draft | published | archived = draft
  created: timestamp = now

transition Post.status
  draft -> published: require author_confirmed
  published -> archived: require admin
  _ -> _: deny

service Posts
  create Post: auth
  read Post by id: auth
  update Post by id: auth
  list Post where author, status: auth, page 25
  delete Post by id: admin
  transition Post.status

service Users
  create User: public, limit 10/minute
  read User by id: auth
  list User where role: admin, page 50

rules PostPolicy
  deny delete Post
  Post.status = published requires admin

guard PostService
  budget: 5.00/task
  classify: internal
  sanitize: all
  audit: mutations

guard UserService
  budget: 3.00/task
  classify: internal
  sanitize: all
  audit: all
```

### 3. Compile

```bash
node ~/glyph-compiler/src/cli.js app.glyph --output-dir ./generated
```

Output:
```
✓ Compiled successfully in 15ms
  Blocks: 12
  Tokens: 287
  Output:
    ./generated/types.ts
    ./generated/schema.sql
    ./generated/routes.ts
    ./generated/guards.json
    ./generated/rules.ts
    ./generated/pipelines.ts
```

### 4. Add the runtime shims

Copy these three files into `./generated/`:

- `db.js` — Postgres connection pool
- `middleware.js` — auth, authorization, validation
- `server.js` — Express app that auto-mounts routers

These are in the `runtime/` directory.

### 5. Set up the database

```bash
createdb glyph_dev
psql glyph_dev < generated/schema.sql
```

### 6. Run it

```bash
DATABASE_URL=postgresql://localhost:5432/glyph_dev node generated/server.js
```

You now have a running API with:
- Typed endpoints with Zod validation
- Rate limiting
- Auth middleware (stub — replace with your JWT logic)
- Row-level security policies in Postgres
- Audit logging for confidential models
- State machine enforcement

---

## What Each Output Does

### `types.ts`
TypeScript interfaces + Zod schemas for every model. Three schemas per model:
- `UserSchema` — full model (for reads)
- `UserCreateSchema` — without auto-generated fields (for POST)
- `UserUpdateSchema` — all fields optional (for PATCH)

### `schema.sql`
Postgres DDL. Includes:
- Tables with CHECK constraints from type definitions
- Foreign keys from `->` relations
- RLS policies from `[confidential, owned by user]` annotations
- Audit log tables + triggers for confidential/restricted models
- `valid_transitions` tables + guard functions for state machines
- Updated_at triggers

### `routes.ts`
Express routers. One router per `service` block. Each action maps to a route:
- `create Model` → `POST /`
- `read Model by id` → `GET /:id`
- `update Model by id` → `PATCH /:id`
- `delete Model by id` → `DELETE /:id`
- `list Model where x, y` → `GET /` with query params
- `search Model` → `GET /search` with full-text search
- `transition Model.field` → `POST /:id/transition`

### `guards.json`
JSON configs for each `guard` block. Use these however you want — feed them to your orchestration layer, use them as runtime config, or just treat them as documentation of your guardrails.

### `rules.ts`
Express middleware generated from `rules` blocks. Business constraints as middleware functions.

### `pipelines.ts`
Event handler scaffolds from `pipeline` blocks. These wire up trigger → step chain → error handling patterns.

---

## The Language in 5 Minutes

**Types** — named constraints on base types:
```
type Money: int >= 0
type Email: text ~ email
type ShortText: text 1..200
```

**Models** — data definitions with classification:
```
model Invoice [confidential, owned by customer]
  id: uuid key
  amount: Money
  status: draft | sent | paid = draft
  created: timestamp = now
```

Annotations like `[confidential, owned by customer]` generate RLS policies, encryption configs, and audit logging.

**Transitions** — state machines with deny-by-default:
```
transition Invoice.status
  draft -> sent: require all_fields_present
  sent -> paid: require payment_confirmed
  _ -> _: deny
```

The `_ -> _: deny` wildcard catch-all means any transition not explicitly listed is blocked.

**Services** — CRUD + modifiers:
```
service Invoices
  create Invoice: auth, limit 100/min
  read Invoice by id: auth
  list Invoice where customer, status: auth, page 50
  transition Invoice.status
```

**Rules** — declarative business constraints:
```
rules InvoicePolicy
  Invoice.amount > 10000 requires board_approval
  Customer.tier = free limits 5 invoices/month
  deny delete Invoice
```

**Guards** — co-located with services (required — won't compile without):
```
guard InvoiceService
  budget: 5.00/task
  classify: confidential
  escalate above 10.00 to strategist
  sanitize: all
```

**Pipelines** — event-driven step chains:
```
pipeline OnInvoicePaid
  when Invoice.status -> paid
  validate -> credit_balance -> generate_receipt -> notify customer
  on failure: retry 3 then escalate
```

**Escape hatch** — for the ~20% that Glyph can't express:
````
```ts
import jwt from 'jsonwebtoken';

export function generateToken(user: User): string {
  return jwt.sign({ sub: user.id }, process.env.JWT_SECRET!);
}
```
````

---

## Customizing the Runtime

The three runtime files (`db.js`, `middleware.js`, `server.js`) are meant to be edited. They're the glue between generated code and your specific stack.

**Auth**: Replace the stub in `middleware.js` with your real JWT/session logic. The generated routes already call `authenticate` and `authorize('admin')` in the right places based on your service definitions.

**Database**: The `db.js` file uses `pg` directly. If you prefer Prisma, Drizzle, or anything else, swap it — the generated SQL routes use `db.query()` with parameterized queries, so adapting is straightforward.

**Hosting**: `server.js` is vanilla Express. Deploy however you deploy Express apps.

---

## File Layout

```
my-service/
├── app.glyph                 # Your source (you write this)
├── generated/                # Compiler output (don't edit)
│   ├── types.ts
│   ├── schema.sql
│   ├── routes.ts
│   ├── guards.json
│   ├── rules.ts
│   ├── pipelines.ts
│   ├── db.js                 # Runtime shim (edit this)
│   ├── middleware.js          # Runtime shim (edit this)
│   └── server.js             # Runtime shim (edit this)
└── package.json
```

Rule of thumb: edit `.glyph` and runtime shims, never edit the `generated/` outputs directly. Recompile when you change the `.glyph` file.
