#!/usr/bin/env node
// ===========================================================================
// Glyph Compiler — Phase D4/D5 Test Suite
// D4: Decompiler (bidirectional mapping)
// D5: Agent prompt templates
// ===========================================================================

import { lex } from '../src/lexer.js';
import { parse } from '../src/parser.js';
import { compile } from '../src/index.js';
import { decompile, decompileWorkItems, decompileFullState } from '../src/decompiler.js';
import { getAgentPrompt, getAllPrompts, estimatePromptTokens } from '../src/agent_prompts.js';
import { generateTaskGraph } from '../src/codegen_taskgraph.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) throw new Error(msg || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function assertIncludes(str, substr, msg) {
  if (!str.includes(substr)) throw new Error(msg || `Expected to include "${substr}"\n  Got: ${str.slice(0, 200)}...`);
}

function parseGlyph(src) { return parse(lex(src)); }

// ===========================================================================
// D4: DECOMPILER TESTS
// ===========================================================================

console.log('\nDECOMPILER — TYPE DEFINITIONS');
console.log('-'.repeat(60));

test('round-trips type with >= constraint', () => {
  const src = 'type Money: int >= 0\n';
  const ast = parseGlyph(src);
  const out = decompile(ast);
  assertIncludes(out, 'type Money: int >= 0');
});

test('round-trips type with pattern', () => {
  const src = 'type Email: text ~ email\n';
  const ast = parseGlyph(src);
  const out = decompile(ast);
  assertIncludes(out, 'type Email: text ~ email');
});

test('round-trips type with range', () => {
  const src = 'type ShortText: text 1..200\n';
  const ast = parseGlyph(src);
  const out = decompile(ast);
  assertIncludes(out, 'type ShortText: text 1..200');
});

console.log('\nDECOMPILER — MODEL DEFINITIONS');
console.log('-'.repeat(60));

test('round-trips simple model', () => {
  const src = `model User [internal]
  id: uuid key
  name: text
  created: timestamp = now
`;
  const ast = parseGlyph(src);
  const out = decompile(ast);
  assertIncludes(out, 'model User [internal]');
  assertIncludes(out, '  id: uuid key');
  assertIncludes(out, '  name: text');
  assertIncludes(out, '  created: timestamp = now');
});

test('round-trips model with classification and ownership', () => {
  const src = `model Invoice [confidential, owned by customer]
  id: uuid key
  amount: int
`;
  const ast = parseGlyph(src);
  const out = decompile(ast);
  assertIncludes(out, 'model Invoice [confidential, owned by customer]');
});

test('round-trips model with relation', () => {
  const src = `model Invoice
  id: uuid key
  customer: -> Customer
`;
  const ast = parseGlyph(src);
  const out = decompile(ast);
  assertIncludes(out, '  customer: -> Customer');
});

test('round-trips model with union type and default', () => {
  const src = `model Item
  id: uuid key
  status: draft | active | archived = draft
`;
  const ast = parseGlyph(src);
  const out = decompile(ast);
  assertIncludes(out, 'draft | active | archived');
  assertIncludes(out, '= draft');
});

test('round-trips optional field', () => {
  const src = `model User
  id: uuid key
  bio: text optional
`;
  const ast = parseGlyph(src);
  const out = decompile(ast);
  assertIncludes(out, '  bio: text optional');
});

console.log('\nDECOMPILER — TRANSITIONS');
console.log('-'.repeat(60));

test('round-trips transition block', () => {
  const src = `transition Invoice.status
  draft -> sent: require all_fields_present
  sent -> paid: require payment_confirmed
  _ -> _: deny
`;
  const ast = parseGlyph(src);
  const out = decompile(ast);
  assertIncludes(out, 'transition Invoice.status');
  assertIncludes(out, '  draft -> sent: require all_fields_present');
  assertIncludes(out, '  _ -> _: deny');
});

test('round-trips transition with within clause', () => {
  const src = `transition Invoice.status
  paid -> void: require admin, within 30 days
  _ -> _: deny
`;
  const ast = parseGlyph(src);
  const out = decompile(ast);
  assertIncludes(out, 'within 30 days');
});

console.log('\nDECOMPILER — SERVICES');
console.log('-'.repeat(60));

test('round-trips service definition', () => {
  const src = `service Invoices
  create Invoice: auth, limit 100/min
  read Invoice by id: auth
  list Invoice where customer, status: auth, page 50
  transition Invoice.status
`;
  const ast = parseGlyph(src);
  const out = decompile(ast);
  assertIncludes(out, 'service Invoices');
  assertIncludes(out, '  create Invoice: auth, limit 100/min');
  assertIncludes(out, '  read Invoice by id: auth');
  assertIncludes(out, 'where customer, status');
  assertIncludes(out, 'page 50');
  assertIncludes(out, '  transition Invoice.status');
});

console.log('\nDECOMPILER — RULES');
console.log('-'.repeat(60));

test('round-trips rules block', () => {
  const src = `rules InvoicePolicy
  Invoice.amount > 10000 requires board_approval
  deny delete Invoice
`;
  const ast = parseGlyph(src);
  const out = decompile(ast);
  assertIncludes(out, 'rules InvoicePolicy');
  assertIncludes(out, 'Invoice.amount > 10000 requires board_approval');
  assertIncludes(out, '  deny delete Invoice');
});

console.log('\nDECOMPILER — GUARDS');
console.log('-'.repeat(60));

test('round-trips guard block', () => {
  const src = `guard InvoiceService
  budget: 5.00/task
  classify: confidential
  escalate above 10.00 to strategist
  sanitize: all
  timeout: 30 seconds
  retry: 3 then escalate
  audit: mutations
`;
  const ast = parseGlyph(src);
  const out = decompile(ast);
  assertIncludes(out, 'guard InvoiceService');
  assertIncludes(out, '  budget: 5/task');
  assertIncludes(out, '  classify: confidential');
  assertIncludes(out, '  escalate above 10 to strategist');
  assertIncludes(out, '  sanitize: all');
  assertIncludes(out, '  timeout: 30 seconds');
  assertIncludes(out, '  retry: 3 then escalate');
  assertIncludes(out, '  audit: mutations');
});

console.log('\nDECOMPILER — PIPELINES');
console.log('-'.repeat(60));

test('round-trips pipeline with transition trigger', () => {
  const src = `pipeline OnInvoicePaid
  when Invoice.status -> paid
  validate -> credit_balance -> notify customer
  on failure: retry 3 then escalate
`;
  const ast = parseGlyph(src);
  const out = decompile(ast);
  assertIncludes(out, 'pipeline OnInvoicePaid');
  assertIncludes(out, '  when Invoice.status -> paid');
  assertIncludes(out, 'validate -> credit_balance -> notify');
  assertIncludes(out, '  on failure: retry 3 then escalate');
});

console.log('\nDECOMPILER — TASKS');
console.log('-'.repeat(60));

test('round-trips task block', () => {
  const src = `task BuildInvoices [high]
  do: Implement invoice CRUD
  accept: All endpoints work
  context: invoice, customer
  route: executor
  budget: 5.00
`;
  const ast = parseGlyph(src);
  const out = decompile(ast);
  assertIncludes(out, 'task BuildInvoices [high]');
  assertIncludes(out, '  do: Implement invoice CRUD');
  assertIncludes(out, '  accept: All endpoints work');
  assertIncludes(out, '  route: executor');
  assertIncludes(out, '  budget: 5.00');
});

test('omits priority bracket for normal tasks', () => {
  const src = `task Simple
  do: Something
`;
  const ast = parseGlyph(src);
  const out = decompile(ast);
  assertIncludes(out, 'task Simple');
  assert(!out.includes('[normal]'), 'should not include [normal] bracket');
});

console.log('\nDECOMPILER — ESCAPE BLOCKS');
console.log('-'.repeat(60));

test('round-trips escape block', () => {
  const src = '```ts\nconst x = 1;\n```\n';
  const ast = parseGlyph(src);
  const out = decompile(ast);
  assertIncludes(out, '```ts');
  assertIncludes(out, 'const x = 1;');
  assertIncludes(out, '```');
});

console.log('\nDECOMPILER — ROUND-TRIP INTEGRATION');
console.log('-'.repeat(60));

test('full round-trip: compile → decompile → recompile', () => {
  const original = `type Money: int >= 0

model Customer [internal]
  id: uuid key
  name: text
  created: timestamp = now

model Invoice [confidential, owned by customer]
  id: uuid key
  customer: -> Customer
  amount: Money
  status: draft | sent | paid = draft

transition Invoice.status
  draft -> sent: require all_fields_present
  _ -> _: deny

service Invoices
  create Invoice: auth, limit 100/min
  read Invoice by id: auth
  list Invoice where customer, status: auth, page 50
  transition Invoice.status

rules InvoicePolicy
  Invoice.amount > 10000 requires board_approval
  deny delete Invoice

guard InvoiceService
  budget: 5.00/task
  classify: confidential
  sanitize: all
  audit: mutations
`;

  // Compile original
  const result1 = compile(original);

  // Decompile AST back to source
  const decompiled = decompile(result1.ast);

  // Recompile the decompiled source
  const result2 = compile(decompiled);

  // Verify structural equivalence
  assertEqual(result2.ast.blocks.length, result1.ast.blocks.length, 'block count mismatch');

  // Verify same number of models, services, etc.
  const count = (ast, kind) => ast.blocks.filter(b => b.kind === kind).length;
  assertEqual(count(result2.ast, 'TypeDef'), count(result1.ast, 'TypeDef'), 'type count mismatch');
  assertEqual(count(result2.ast, 'ModelDef'), count(result1.ast, 'ModelDef'), 'model count mismatch');
  assertEqual(count(result2.ast, 'ServiceDef'), count(result1.ast, 'ServiceDef'), 'service count mismatch');
  assertEqual(count(result2.ast, 'TransitionDef'), count(result1.ast, 'TransitionDef'), 'transition count mismatch');
  assertEqual(count(result2.ast, 'RulesDef'), count(result1.ast, 'RulesDef'), 'rules count mismatch');
  assertEqual(count(result2.ast, 'GuardDef'), count(result1.ast, 'GuardDef'), 'guard count mismatch');
});

console.log('\nDECOMPILER — WORK ITEMS');
console.log('-'.repeat(60));

test('decompiles work_items JSON to task blocks', () => {
  const items = [
    {
      name: 'BuildUserService',
      priority: 'high',
      description: 'Implement user management CRUD',
      acceptance_criteria: 'All endpoints work',
      routing_class: 'executor',
      cost_budget: 5.0,
      parent_id: 'DesignSchema',
      dependency_ids: ['BuildAuthService'],
      context_profile_json: { domain_hints: ['user', 'auth'] },
    },
  ];
  const out = decompileWorkItems(items);
  assertIncludes(out, 'task BuildUserService [high]');
  assertIncludes(out, '  do: Implement user management CRUD');
  assertIncludes(out, '  accept: All endpoints work');
  assertIncludes(out, '  context: user, auth');
  assertIncludes(out, '  route: executor');
  assertIncludes(out, '  parent: DesignSchema');
  assertIncludes(out, '  depends: BuildAuthService');
  assertIncludes(out, '  budget: 5');
});

test('decompiles multiple work items', () => {
  const items = [
    { name: 'TaskA', priority: 'normal', description: 'First', routing_class: 'executor', context_profile_json: {} },
    { name: 'TaskB', priority: 'high', description: 'Second', routing_class: 'architect', context_profile_json: {} },
  ];
  const out = decompileWorkItems(items);
  assertIncludes(out, 'task TaskA');
  assertIncludes(out, 'task TaskB [high]');
});

test('decompileFullState merges AST + work items', () => {
  const src = `type Money: int >= 0

model Invoice
  id: uuid key
  amount: Money

service Invoices
  create Invoice: auth

guard InvoiceService
  budget: 5.00/task
  classify: internal
`;
  const ast = parseGlyph(src);
  const items = [
    { name: 'BuildInvoice', priority: 'high', description: 'Build it', routing_class: 'executor', cost_budget: 5, context_profile_json: { domain_hints: ['invoice'] } },
  ];
  const out = decompileFullState(items, ast);
  assertIncludes(out, 'type Money: int >= 0');
  assertIncludes(out, 'model Invoice');
  assertIncludes(out, 'service Invoices');
  assertIncludes(out, 'guard InvoiceService');
  assertIncludes(out, 'task BuildInvoice [high]');
});


// ===========================================================================
// D5: AGENT PROMPT TEMPLATE TESTS
// ===========================================================================

console.log('\nAGENT PROMPT TEMPLATES (D5)');
console.log('-'.repeat(60));

test('generates prompt for each tier', () => {
  const tiers = ['strategist', 'architect', 'executor', 'reviewer', 'utility'];
  for (const tier of tiers) {
    const prompt = getAgentPrompt(tier);
    assert(prompt.length > 500, `${tier} prompt should be substantial (got ${prompt.length} chars)`);
    assertIncludes(prompt, 'Glyph', `${tier} prompt should mention Glyph`);
  }
});

test('all prompts include base language reference', () => {
  const tiers = ['strategist', 'architect', 'executor', 'reviewer', 'utility'];
  for (const tier of tiers) {
    const prompt = getAgentPrompt(tier);
    assertIncludes(prompt, 'model', `${tier} should include model syntax`);
    assertIncludes(prompt, 'service', `${tier} should include service syntax`);
    assertIncludes(prompt, 'guard', `${tier} should include guard syntax`);
    assertIncludes(prompt, '_ -> _: deny', `${tier} should include deny-by-default pattern`);
  }
});

test('strategist prompt focuses on task decomposition', () => {
  const prompt = getAgentPrompt('strategist');
  assertIncludes(prompt, 'Strategist');
  assertIncludes(prompt, 'task');
  assertIncludes(prompt, 'budget');
  assertIncludes(prompt, 'depends');
});

test('architect prompt focuses on schema design', () => {
  const prompt = getAgentPrompt('architect');
  assertIncludes(prompt, 'Architect');
  assertIncludes(prompt, 'model');
  assertIncludes(prompt, 'transition');
  assertIncludes(prompt, 'pipeline');
});

test('executor prompt focuses on implementation', () => {
  const prompt = getAgentPrompt('executor');
  assertIncludes(prompt, 'Executor');
  assertIncludes(prompt, 'escape hatch');
  assertIncludes(prompt, '```ts');
});

test('reviewer prompt focuses on security checks', () => {
  const prompt = getAgentPrompt('reviewer');
  assertIncludes(prompt, 'Reviewer');
  assertIncludes(prompt, 'classification');
  assertIncludes(prompt, 'audit');
  assertIncludes(prompt, 'sanitize');
});

test('utility prompt focuses on summarization', () => {
  const prompt = getAgentPrompt('utility');
  assertIncludes(prompt, 'Utility');
  assertIncludes(prompt, 'summar');
  assertIncludes(prompt, 'compress');
});

test('getAllPrompts returns all 5 tiers', () => {
  const all = getAllPrompts();
  assertEqual(Object.keys(all).length, 5);
  assert('strategist' in all);
  assert('executor' in all);
});

test('prompt token estimates are reasonable', () => {
  const tiers = ['strategist', 'architect', 'executor', 'reviewer', 'utility'];
  for (const tier of tiers) {
    const tokens = estimatePromptTokens(tier);
    assert(tokens > 500, `${tier} should be > 500 tokens (got ${tokens})`);
    assert(tokens < 5000, `${tier} should be < 5000 tokens (got ${tokens})`);
  }
});

test('rejects unknown tier', () => {
  try {
    getAgentPrompt('invalid_tier');
    assert(false, 'should throw');
  } catch (e) {
    assertIncludes(e.message, 'Unknown agent tier');
  }
});

test('accepts additional context', () => {
  const prompt = getAgentPrompt('executor', {
    additionalContext: ['# Project: Billing\nFocus on payment processing.'],
  });
  assertIncludes(prompt, 'Additional Context');
  assertIncludes(prompt, 'payment processing');
});

// ===========================================================================
// SUMMARY
// ===========================================================================

console.log('\n' + '='.repeat(60));
console.log(`Phase D4/D5 Tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
