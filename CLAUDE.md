# Glyph Language Reference

You can read and write Glyph, a token-optimized language for defining backend services. A single `.glyph` file compiles to TypeScript types, Zod validators, Postgres DDL, Express routes, and guardrail configs.

## Syntax

### Types — named constraints on base types
```
type Money: int >= 0
type Email: text ~ email
type ShortText: text 1..200
```

Base types: `int`, `float`, `text`, `bool`, `uuid`, `timestamp`, `date`, `time`, `json`, `bytes`
Constraints: `>=`, `<=`, `>`, `<`, `~` (pattern), `..` (range)
Patterns: `email`, `url`, `phone`, `slug`, `ip`

### Models — data definitions with classification
```
model Invoice [confidential, owned by customer]
  id: uuid key
  customer: -> Customer
  amount: Money
  status: draft | sent | paid | void = draft
  created: timestamp = now
```

- Fixed 2-space indentation, no braces, no semicolons
- `[classification]` generates RLS policies, audit logging, encryption config
- Classification levels: `public`, `internal`, `confidential`, `restricted`
- `owned by <field>` generates row-level ownership policies
- `->` is a foreign key relation
- `|` defines union/enum types
- Field modifiers: `key`, `unique`, `optional`, `index`, `= default`
- Fields are required by default; use `optional` to make nullable
- Models are `internal` by default

### Transitions — state machines, deny by default
```
transition Invoice.status
  draft -> sent: require all_fields_present
  sent -> paid: require payment_confirmed
  paid -> void: require admin, within 30 days
  _ -> _: deny
```

- `_ -> _: deny` is the wildcard catch-all — anything not listed is blocked
- Actions: `require <guard>`, `deny`, `within <duration>`, `notify <target>`, `log`
- Always end with `_ -> _: deny` to enforce deny-by-default

### Services — CRUD with modifiers
```
service Invoices
  create Invoice: auth, limit 100/min
  read Invoice by id: auth
  list Invoice where customer, status: auth, page 50
  transition Invoice.status
```

- Verbs: `create`, `read`, `update`, `delete`, `list`, `search`, `archive`, `restore`, `export`, `import`
- `by <field>` specifies lookup key
- `where <fields>` specifies filter params
- Modifiers: `auth`, `public`, `admin`, `role <n>`, `limit <n>/<unit>`, `page <n>`, `cache <duration>`
- Services require `auth` by default in practice — always specify it

### Rules — declarative business constraints
```
rules InvoicePolicy
  Invoice.amount > 10000 requires board_approval
  Customer.tier = free limits 5 invoices/month
  deny delete Invoice
```

### Guards — co-located with services (required)
```
guard InvoiceService
  budget: 5.00/task
  classify: confidential
  escalate above 10.00 to strategist
  sanitize: all
  timeout: 30 seconds
  retry: 3 then escalate
  audit: mutations
```

- A service CANNOT compile without a matching guard block
- Guard name must match: `ServiceName`, `ServiceNameService`, or singular form + `Service`
- Directives: `budget`, `classify`, `escalate`, `sanitize`, `timeout`, `retry`, `audit`
- Audit scope: `all`, `mutations`, `reads`, `none`

### Pipelines — event-driven step chains
```
pipeline OnInvoicePaid
  when Invoice.status -> paid
  validate -> credit_balance -> generate_receipt -> notify customer
  on failure: retry 3 then escalate
```

- Triggers: `when Model.field -> state`, `when <event>`, `when <verb> Model`, `every <duration>`, `on <verb> Model`
- Steps chained with `->`
- Error handling: `retry <n> then <escalate|fail|skip|rollback>`

### Tasks — work items for agent orchestration
```
task BuildInvoiceService [high]
  do: Implement the invoice service with all CRUD operations
  accept: All endpoints work, validation passes, auth enforced
  context: invoice, customer, payment
  route: executor
  parent: DesignSchema
  depends: BuildCustomerService
  budget: 5.00
```

- Priority: `critical`, `high`, `normal`, `low` (default: `normal`)
- Route: `strategist`, `architect`, `executor`, `reviewer`, `utility`
- If route is omitted, the compiler infers it from task structure

### Escape hatch — embedded TypeScript for the ~20% case
````
```ts
import jwt from 'jsonwebtoken';

export function generateToken(user: User): string {
  return jwt.sign({ sub: user.id }, process.env.JWT_SECRET!);
}
```
````

Use escape hatches for: complex computed fields, custom middleware, third-party API calls, queries with 3+ JOINs, dynamic permissions, file handling.

## Complete Example

```
type Money: int >= 0
type Email: text ~ email

model Customer [internal]
  id: uuid key
  name: text 1..200
  email: Email unique
  tier: free | pro | enterprise = free
  created: timestamp = now

model Invoice [confidential, owned by customer]
  id: uuid key
  customer: -> Customer
  amount: Money
  status: draft | sent | paid | void = draft
  created: timestamp = now

transition Invoice.status
  draft -> sent: require all_fields_present
  sent -> paid: require payment_confirmed
  paid -> void: require admin, within 30 days
  _ -> _: deny

service Invoices
  create Invoice: auth, limit 100/min
  read Invoice by id: auth
  list Invoice where customer, status: auth, page 50
  transition Invoice.status

rules InvoicePolicy
  Invoice.amount > 10000 requires board_approval
  Customer.tier = free limits 5 invoices/month
  deny delete Invoice

guard InvoiceService
  budget: 5.00/task
  classify: confidential
  escalate above 10.00 to strategist
  sanitize: all

pipeline OnInvoicePaid
  when Invoice.status -> paid
  validate -> credit_balance -> generate_receipt -> notify customer
  on failure: retry 3 then escalate
```

## Key Rules
1. Every service needs a guard block — won't compile without it
2. Every transition block should end with `_ -> _: deny`
3. Indentation is exactly 2 spaces
4. No braces, no semicolons, no parentheses in normal usage
5. Fields are required by default; mark `optional` explicitly
6. `->` means different things by context: foreign key in models, state change in transitions, step chain in pipelines
