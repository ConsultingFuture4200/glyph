# Building a Package Registry with Glyph + Multi-Agent Systems

A concrete, end-to-end walkthrough showing how a multi-agent system uses Glyph to design, build, review, and ship a backend service — from a single directive to running code.

---

## The Directive

A human says:

> "Build an npm-style package registry. Authors publish packages with versions and dependencies. Packages can be deprecated or unpublished. Scoped packages require org membership."

That's it. Here's what happens next.

---

## Phase 1: Strategist Decomposes the Directive

The **strategist** agent receives the directive and the Glyph base prompt (~800 tokens). It produces a task graph:

```
task DesignRegistrySchema [critical]
  do: Design data models for authors, packages, versions, and dependencies
  accept: All models defined with types, relations, classifications, and ownership
  context: author, package, version, dependency
  route: architect
  budget: 12.00

task ImplementPackageService [normal]
  do: Implement CRUD, search, and state transitions for packages
  accept: All endpoints compile, auth enforced, rate limits set
  context: package, author
  route: executor
  parent: DesignRegistrySchema
  depends: ImplementAuthorService
  budget: 5.00

task ImplementVersionService [normal]
  do: Implement version publishing and listing
  accept: Versions linked to packages, admin-only delete, pagination works
  context: version, package
  route: executor
  parent: DesignRegistrySchema
  depends: ImplementPackageService
  budget: 5.00

task ImplementAuthorService [normal]
  do: Implement author registration and lookup
  accept: Author CRUD works, public read, auth on list
  context: author
  route: executor
  parent: DesignRegistrySchema
  budget: 3.00

task ReviewRegistrySecurity [high]
  do: Audit all guards, classifications, RLS policies, and business rules
  accept: No PII leaks, guards match services, deny-by-default enforced
  context: package, version, author, security
  route: reviewer
  depends: ImplementVersionService
  budget: 6.00

task SetupMonitoring [low]
  do: Generate context summaries and monitoring stubs for the registry
  accept: Summaries under 200 tokens each, monitoring tasks defined
  context: monitoring, registry
  route: utility
  depends: ReviewRegistrySecurity
  budget: 2.00
```

**Token cost**: ~400 tokens of Glyph task blocks define the entire project plan.

**What the orchestrator now has**:
- 6 work items with priorities, budgets, and dependencies
- A DAG: `DesignRegistrySchema` → `ImplementAuthorService` → `ImplementPackageService` → `ImplementVersionService` → `ReviewRegistrySecurity` → `SetupMonitoring`
- Routing: each task goes to the right agent tier

---

## Phase 2: Architect Designs the Schema

The **architect** agent receives:
- Its tier prompt from `getAgentPrompt('architect')` (~1,600 tokens)
- The task: "Design data models for authors, packages, versions, and dependencies"

It writes the Glyph source — the full service definition:

```
type PackageName: text ~ slug
type SemVer: text 1..20
type Email: text ~ email
type Url: text ~ url
type ShortText: text 1..200
type LongText: text 1..5000

model Author [internal]
  id: uuid key
  name: ShortText
  email: Email unique
  created: timestamp = now

model Package [internal, owned by author]
  id: uuid key
  name: PackageName unique
  description: LongText optional
  author: -> Author
  license: mit | isc | apache2 | gpl3 | bsd2 = mit
  homepage: Url optional
  repository: Url optional
  status: active | deprecated | unpublished = active
  created: timestamp = now

model PackageVersion [confidential, owned by author]
  id: uuid key
  package: -> Package
  version: SemVer
  main: ShortText optional
  type: module | commonjs = module
  tarball_url: Url
  download_count: int >= 0
  published_at: timestamp = now

model Dependency [internal]
  id: uuid key
  version: -> PackageVersion
  dep_name: PackageName
  dep_range: SemVer
  kind: production | dev | peer | optional = production

transition Package.status
  active -> deprecated: require author, log
  deprecated -> active: require author, log
  active -> unpublished: require admin, within 72 hours
  _ -> _: deny

service Packages
  create Package: auth, limit 50/min
  read Package by id: auth
  read Package by name: auth
  list Package where author, status: auth, page 25
  search Package: public, page 50
  update Package: auth
  transition Package.status

service Versions
  create PackageVersion: auth, limit 100/min
  read PackageVersion by id: auth
  list PackageVersion where package: auth, page 50
  delete PackageVersion: admin

service Authors
  create Author: auth, limit 10/min
  read Author by id: public
  list Author: auth, page 50

rules PackagePolicy
  deny delete Package
  Package.name ~ "^@" requires org_membership

guard PackageService
  budget: 5.00/task
  classify: internal
  sanitize: all
  timeout: 30 seconds
  retry: 3 then escalate
  audit: mutations

guard VersionService
  budget: 3.00/task
  classify: confidential
  sanitize: all
  timeout: 60 seconds
  audit: all

guard AuthorService
  budget: 2.00/task
  classify: internal
  sanitize: all
  audit: mutations

pipeline OnPackagePublished
  when PackageVersion.published_at -> published_at
  validate -> index_search -> update_stats -> notify author
  on failure: retry 3 then escalate

pipeline OnPackageDeprecated
  when Package.status -> deprecated
  notify_dependents -> update_search_index
  on failure: retry 2 then rollback
```

**Token cost**: ~625 tokens for the complete service definition.

**What was decided in those 625 tokens**:
- 4 models with 25+ fields, relations, constraints, and defaults
- Data classification (internal vs. confidential) driving RLS and audit policies
- Ownership policies for row-level security
- A 4-state transition machine with deny-by-default
- 3 services with 11 endpoints, auth, rate limits, pagination
- Business rules (no package deletion, scoped packages need org membership)
- 3 guard blocks with budgets, timeouts, retry strategies, audit scopes
- 2 event-driven pipelines with error handling

---

## Phase 3: Compilation

The orchestrator runs:

```bash
node compiler/src/cli.js package_registry.glyph --output-dir ./out
```

Output in ~11ms:

```
out/
  types.ts            # 193 lines — TypeScript interfaces + Zod schemas
  schema.sql          # 233 lines — Postgres DDL, RLS, audit triggers
  routes.ts           # 301 lines — Express routers with auth + rate limits
  guards.json         # 121 lines — Runtime guardrail configs
  context_profiles.json  # 281 lines — Per-model context windows for agents
```

**625 tokens → 7,716 tokens of generated code. 12.3x expansion. 92% token reduction.**

---

## Phase 4: Executor Implements (With Context Profiles)

The **executor** agents don't get the full codebase. Each one gets a **scoped context profile** from `context_profiles.json`.

### Example: Executor working on the Package service

The orchestrator loads the `service:Packages` context profile:

```json
{
  "required_context": {
    "types": ["PackageName", "Email", "Url", "ShortText", "LongText"],
    "models": ["Package", "Author"],
    "services": ["Packages"],
    "transitions": [{"model": "Package", "field": "status"}],
    "rules": ["PackagePolicy"],
    "guards": ["PackageService"]
  },
  "token_budget": {
    "estimated_tokens": 282,
    "estimated_nl_equivalent": 1410,
    "compression_ratio": 0.2
  }
}
```

The executor receives only the Glyph blocks listed in `required_context` — not the entire file, not the Version or Dependency models, not the Author service. Just what it needs.

**Context window cost**: ~282 tokens instead of ~1,410 tokens of equivalent natural language.

The executor's job: verify the compiled output matches the spec, add escape hatches for anything Glyph can't express (Stripe integration, custom search ranking, etc.), and flag issues back to the architect.

### Example: Executor adds an escape hatch

The executor finds that full-text search needs custom Postgres config. It adds:

````
```ts
import { db } from './db.js';

export async function searchPackages(query: string, limit = 50) {
  const result = await db.query(
    `SELECT *, ts_rank(search_vector, plainto_tsquery($1)) as rank
     FROM packages
     WHERE search_vector @@ plainto_tsquery($1)
     ORDER BY rank DESC
     LIMIT $2`,
    [query, limit]
  );
  return result.rows;
}
```
````

Escape hatch ratio stays under 20% — no need to escalate.

---

## Phase 5: Reviewer Audits

The **reviewer** agent receives the full Glyph source and its tier prompt. It runs the review checklist:

| Check | Status | Notes |
|---|---|---|
| Guard co-location | Pass | All 3 services have matching guards |
| Deny-by-default | Pass | `_ -> _: deny` present in transition |
| Classification | Pass | PackageVersion is `confidential` (has tarball URLs, download counts) |
| Ownership | Pass | Package `owned by author`, PackageVersion `owned by author` |
| Audit scope | Pass | Confidential VersionService has `audit: all` |
| Rate limiting | Pass | All mutation endpoints have `limit` |
| Business rules | Pass | Package deletion denied, scoped packages gated |
| Sanitization | Pass | All guards have `sanitize: all` |

The reviewer also checks the guard configs from `guards.json`:

```json
{
  "VersionService": {
    "directives": {
      "classification": {
        "level": "confidential",
        "encryption_at_rest": true,
        "audit_access": true
      },
      "budget": {
        "max_per_unit": 3,
        "unit": "task",
        "action_on_exceed": "deny"
      }
    }
  }
}
```

Encryption at rest is auto-enabled for confidential data. Budget caps prevent runaway agent costs. The reviewer approves.

---

## Phase 6: Utility Compresses Context

The **utility** agent generates a compact summary for future agents that need registry context:

```
# Context: PackageRegistry
# Models: Author(internal), Package(internal, owned), PackageVersion(confidential, owned), Dependency(internal)
# Types: PackageName~slug, SemVer 1..20, Email~email, Url~url, ShortText 1..200, LongText 1..5000
# Transitions: Package.status(active→deprecated→active, active→unpublished, deny default)
# Services: Packages(CRUD+search+transition), Versions(CRUD), Authors(CRUD)
# Guards: PackageService($5/task,30s), VersionService($3/task,60s), AuthorService($2/task)
# Rules: no delete Package, scoped @packages→org_membership
# Pipelines: OnPackagePublished(4 steps), OnPackageDeprecated(2 steps+rollback)
```

**~150 tokens** captures the entire system. Any future agent loading "package registry" context gets this instead of reading 1,127 lines of generated code.

---

## The Token Economics

| Stage | Agent | Input Tokens | Output Tokens | Cost |
|---|---|---|---|---|
| Decompose | Strategist | ~1,200 | ~400 | ~$0.02 |
| Design | Architect | ~1,800 | ~625 | ~$0.03 |
| Compile | (compiler) | 625 | 7,716 | free |
| Implement (x3) | Executor | ~850 each | ~200 each | ~$0.04 |
| Review | Reviewer | ~2,200 | ~300 | ~$0.03 |
| Summarize | Utility | ~1,000 | ~150 | ~$0.01 |
| **Total** | | **~9,750** | **~9,491** | **~$0.13** |

**Without Glyph**, agents would pass around ~7,716 tokens of TypeScript/SQL/Express code at every step. With Glyph, they pass ~625 tokens of `.glyph` source. Every inter-agent handoff saves ~7,000 tokens.

Over a 10-task project with 5 handoffs per task, that's **~350,000 tokens saved** — roughly $3.50 in API costs and significant context window preservation.

---

## How to Wire It Up

### 1. Load the tier prompt

```js
import { getAgentPrompt } from './compiler/src/agent_prompts.js';

const systemPrompt = getAgentPrompt('executor', {
  additionalContext: [glyphSource, contextProfile]
});
```

### 2. Compile after the architect writes

```js
import { compile } from './compiler/src/index.js';

const result = compile(glyphSource);
// result.types, result.sql, result.routes, result.guards, result.contextProfiles
```

### 3. Route tasks by tier

```js
const TIER_MODELS = {
  strategist: 'claude-opus-4-6',      // Planning needs strong reasoning
  architect:  'claude-sonnet-4-6',    // Design is structured, sonnet handles it
  executor:   'claude-sonnet-4-6',    // Implementation is well-scoped
  reviewer:   'claude-sonnet-4-6',    // Checklist-driven review
  utility:    'claude-haiku-4-5',     // Summarization is lightweight
};
```

### 4. Scope context per task

```js
const profile = contextProfiles[`service:${taskContext}`];
const scopedGlyph = extractBlocks(glyphSource, profile.required_context);
// Agent only sees the blocks it needs — not the full file
```

### 5. Enforce guard budgets at runtime

```js
const guard = guards[serviceName];
if (tokensUsed > guard.directives.budget.max_per_unit * 1000) {
  // Budget exceeded — deny or escalate based on guard config
  if (guard.directives.budget.action_on_exceed === 'deny') {
    throw new Error(`Budget exceeded for ${serviceName}`);
  }
}
```

---

## Key Takeaways

1. **Glyph is the inter-agent protocol.** Agents read and write ~625 tokens instead of ~7,716 tokens of generated code. The compiler handles the expansion.

2. **Context profiles scope agent attention.** Each agent gets only the models, types, and services relevant to its task — not the full codebase.

3. **Guards are agent guardrails.** Budget caps, timeouts, retry strategies, and audit scopes defined in `.glyph` compile to runtime configs that constrain agent behavior.

4. **Tasks are the orchestration layer.** The strategist writes the DAG, the compiler extracts dependencies, and the orchestrator dispatches to the cheapest capable tier.

5. **The utility agent is the compression layer.** It generates ~150-token summaries that replace ~7,000 tokens of raw code for future context loading.

The entire package registry — 4 models, 3 services, 11 endpoints, state machines, business rules, audit logging, RLS policies, event pipelines — was designed, built, reviewed, and documented by 6 agents using ~9,750 input tokens total. Without Glyph, that same coordination would have consumed ~50,000+ tokens in code passing alone.
