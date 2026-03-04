#!/usr/bin/env node
// ===========================================================================
// Glyph Compiler — Phase D Test Suite
// Task Graph Integration: work_items, context profiles, routing inference
// ===========================================================================

import { lex } from '../src/lexer.js';
import { parse } from '../src/parser.js';
import { compile } from '../src/index.js';
import { inferRoutingClass, generateContextProfile, generateTaskGraph } from '../src/codegen_taskgraph.js';

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

// Helper: parse a glyph source and return the AST
function parseGlyph(src) {
  return parse(lex(src));
}

// ---------------------------------------------------------------------------
// ROUTING INFERENCE TESTS (D3)
// ---------------------------------------------------------------------------

console.log('\nROUTING INFERENCE TESTS (D3)');
console.log('-'.repeat(60));

test('explicit route field wins', () => {
  const ast = parseGlyph(`
model Item
  id: uuid key

service Items
  create Item: auth

guard ItemService
  budget: 1.00/task
  classify: internal

task Build [high]
  do: Build everything
  route: architect
  budget: 50.00
`);
  const task = ast.blocks.find(b => b.kind === 'TaskDef');
  const result = inferRoutingClass(task, ast);
  assertEqual(result.routingClass, 'architect');
  assertEqual(result.confidence, 1.0);
  assertEqual(result.reason, 'explicit_route_field');
});

test('high budget infers strategist', () => {
  const ast = parseGlyph(`
model Item
  id: uuid key

task PlanBudget [high]
  do: Evaluate cost and spending strategy
  accept: Budget plan approved
  budget: 15.00
`);
  const task = ast.blocks.find(b => b.kind === 'TaskDef');
  const result = inferRoutingClass(task, ast);
  assertEqual(result.routingClass, 'strategist');
  assert(result.confidence >= 0.8, `confidence should be >= 0.8, got ${result.confidence}`);
});

test('critical priority infers strategist', () => {
  const ast = parseGlyph(`
task Urgent [critical]
  do: Handle the critical situation
  accept: Resolved
`);
  const task = ast.blocks.find(b => b.kind === 'TaskDef');
  const result = inferRoutingClass(task, ast);
  assertEqual(result.routingClass, 'strategist');
});

test('review/audit language infers reviewer', () => {
  const ast = parseGlyph(`
task SecurityAudit [high]
  do: Review and audit security configuration for compliance
  accept: All checks pass, report generated
`);
  const task = ast.blocks.find(b => b.kind === 'TaskDef');
  const result = inferRoutingClass(task, ast);
  assertEqual(result.routingClass, 'reviewer');
  assert(result.confidence >= 0.7, `confidence should be >= 0.7, got ${result.confidence}`);
});

test('monitoring/notification language infers utility', () => {
  const ast = parseGlyph(`
task SetupAlerts [normal]
  do: Configure alert notifications and summarize current monitoring state
  accept: Alerts configured
`);
  const task = ast.blocks.find(b => b.kind === 'TaskDef');
  const result = inferRoutingClass(task, ast);
  assertEqual(result.routingClass, 'utility');
});

test('simple CRUD defaults to executor', () => {
  const ast = parseGlyph(`
model User
  id: uuid key
  name: text

task ImplementCRUD [normal]
  do: Implement CRUD endpoints for User
  accept: All endpoints work
  context: user
`);
  const task = ast.blocks.find(b => b.kind === 'TaskDef');
  const result = inferRoutingClass(task, ast);
  assertEqual(result.routingClass, 'executor');
});

test('multi-service + architectural language infers architect', () => {
  const ast = parseGlyph(`
model User
  id: uuid key

model Order
  id: uuid key
  user: -> User

model Payment
  id: uuid key
  order: -> Order

service Users
  create User: auth

service Orders
  create Order: auth

service Payments
  create Payment: auth

guard UserService
  budget: 1.00/task
  classify: internal

guard OrderService
  budget: 1.00/task
  classify: internal

guard PaymentService
  budget: 1.00/task
  classify: internal

task DesignIntegration [high]
  do: Design integration schema between users, orders, and payments
  accept: Schema reviewed, migration plan documented
  context: user, order, payment
`);
  const task = ast.blocks.find(b => b.kind === 'TaskDef');
  const result = inferRoutingClass(task, ast);
  assertEqual(result.routingClass, 'architect');
});

test('CRUD across multiple services stays executor', () => {
  const ast = parseGlyph(`
model User
  id: uuid key

model Comment
  id: uuid key
  user: -> User

service Users
  create User: auth

service Comments
  create Comment: auth

guard UserService
  budget: 1.00/task
  classify: internal

guard CommentService
  budget: 1.00/task
  classify: internal

task BuildComments [normal]
  do: Implement CRUD for comments on users
  accept: Comments created and listed
  context: comment, user
`);
  const task = ast.blocks.find(b => b.kind === 'TaskDef');
  const result = inferRoutingClass(task, ast);
  assertEqual(result.routingClass, 'executor');
});

// ---------------------------------------------------------------------------
// CONTEXT PROFILE TESTS (D2)
// ---------------------------------------------------------------------------

console.log('\nCONTEXT PROFILE TESTS (D2)');
console.log('-'.repeat(60));

test('context profile includes referenced models', () => {
  const ast = parseGlyph(`
type Email: text ~ email

model Customer
  id: uuid key
  email: Email unique

model Invoice
  id: uuid key
  customer: -> Customer
  amount: int

task ImplementInvoice [normal]
  do: Build invoice service
  accept: Invoices created
  context: invoice
`);
  const task = ast.blocks.find(b => b.kind === 'TaskDef');
  const profile = generateContextProfile(task, ast);
  assert(profile.required_context.models.includes('Invoice'), 'should include Invoice');
  assert(profile.required_context.models.includes('Customer'), 'should include Customer via relation expansion');
});

test('context profile includes types used by models', () => {
  const ast = parseGlyph(`
type Money: int >= 0

model Invoice
  id: uuid key
  amount: Money

task ImplementInvoice [normal]
  do: Build invoice features
  context: invoice
`);
  const task = ast.blocks.find(b => b.kind === 'TaskDef');
  const profile = generateContextProfile(task, ast);
  assert(profile.required_context.types.includes('Money'), 'should include Money type');
});

test('context profile includes transitions for referenced models', () => {
  const ast = parseGlyph(`
model Invoice
  id: uuid key
  status: draft | paid = draft

transition Invoice.status
  draft -> paid: require payment
  _ -> _: deny

task HandlePayments [normal]
  do: Implement payment flow for invoices
  context: invoice
`);
  const task = ast.blocks.find(b => b.kind === 'TaskDef');
  const profile = generateContextProfile(task, ast);
  assert(profile.required_context.transitions.length >= 1, 'should include Invoice.status transition');
  assertEqual(profile.required_context.transitions[0].model, 'Invoice');
});

test('context profile includes services inferred from models', () => {
  const ast = parseGlyph(`
model Item
  id: uuid key
  name: text

service Items
  create Item: auth

guard ItemService
  budget: 1.00/task
  classify: internal

task ImplementItem [normal]
  do: Build item features
  context: item
`);
  const task = ast.blocks.find(b => b.kind === 'TaskDef');
  const profile = generateContextProfile(task, ast);
  assert(profile.required_context.services.includes('Items'), 'should infer Items service');
});

test('context profile tracks parent and depends', () => {
  const ast = parseGlyph(`
model Item
  id: uuid key

task Parent [normal]
  do: Parent task

task Child [normal]
  do: Child task
  parent: Parent
  depends: Parent, OtherTask
`);
  const task = ast.blocks.find(b => b.name === 'Child');
  const profile = generateContextProfile(task, ast);
  assertEqual(profile.prior_work.parent, 'Parent');
  assert(profile.prior_work.depends.includes('Parent'));
  assert(profile.prior_work.depends.includes('OtherTask'));
  assertEqual(profile.prior_work.load_siblings, true);
});

test('token budget estimates are reasonable', () => {
  const ast = parseGlyph(`
type Money: int >= 0

model Customer
  id: uuid key
  name: text

model Invoice
  id: uuid key
  customer: -> Customer
  amount: Money
  status: draft | paid = draft

service Invoices
  create Invoice: auth
  list Invoice where customer: auth, page 50

guard InvoiceService
  budget: 5.00/task
  classify: internal

task ImplementInvoice [normal]
  do: Build invoice service
  context: invoice, customer
  parent: DesignSchema
`);
  const task = ast.blocks.find(b => b.kind === 'TaskDef');
  const profile = generateContextProfile(task, ast);
  const budget = profile.token_budget;

  assert(budget.estimated_tokens > 0, 'should have positive token estimate');
  assert(budget.estimated_tokens < 1000, 'should be under 1000 tokens for small service');
  assertEqual(budget.compression_ratio, 0.2);
  assertEqual(budget.estimated_nl_equivalent, budget.estimated_tokens * 5);
  assert(budget.breakdown.agent_identity === 80, 'should have 80 token agent identity');
});

// ---------------------------------------------------------------------------
// WORK ITEMS COMPILATION TESTS (D1)
// ---------------------------------------------------------------------------

console.log('\nWORK ITEMS COMPILATION TESTS (D1)');
console.log('-'.repeat(60));

test('compiles task to work_item row', () => {
  const ast = parseGlyph(`
model Item
  id: uuid key

task BuildItem [high]
  do: Implement item management
  accept: All CRUD works
  context: item
  route: executor
  budget: 5.00
`);
  const result = generateTaskGraph(ast);
  assertEqual(result.workItems.length, 1);

  const item = result.workItems[0];
  assertEqual(item.name, 'BuildItem');
  assertEqual(item.description, 'Implement item management');
  assertEqual(item.acceptance_criteria, 'All CRUD works');
  assertEqual(item.priority, 'high');
  assertEqual(item.routing_class, 'executor');
  assertEqual(item.cost_budget, 5.00);
  assertEqual(item.status, 'pending');
  assert(item.context_profile_json !== null, 'should have context profile');
  assertEqual(item._source.language, 'glyph');
});

test('default priority is normal', () => {
  const ast = parseGlyph(`
task SimpleThing
  do: Something simple
`);
  const result = generateTaskGraph(ast);
  assertEqual(result.workItems[0].priority, 'normal');
});

test('generates valid SQL', () => {
  const ast = parseGlyph(`
model Item
  id: uuid key

task Build [normal]
  do: Build it
  accept: It works
  budget: 3.00
`);
  const result = generateTaskGraph(ast);
  assert(result.sql.includes('CREATE TABLE IF NOT EXISTS work_items'), 'should have CREATE TABLE');
  assert(result.sql.includes('INSERT INTO work_items'), 'should have INSERT');
  assert(result.sql.includes("'Build'"), 'should have task name');
  assert(result.sql.includes("'executor'"), 'should have routing class');
  assert(result.sql.includes('context_profile_json'), 'should include context profile');
});

test('generates valid JSON', () => {
  const ast = parseGlyph(`
task A [high]
  do: First task

task B [normal]
  do: Second task
  parent: A
  depends: A
`);
  const result = generateTaskGraph(ast);
  const parsed = JSON.parse(result.json);
  assertEqual(parsed.length, 2);
  assertEqual(parsed[0].name, 'A');
  assertEqual(parsed[1].name, 'B');
  assertEqual(parsed[1].parent_id, 'A');
  assert(parsed[1].dependency_ids.includes('A'));
});

test('multiple tasks get independent context profiles', () => {
  const ast = parseGlyph(`
model User
  id: uuid key

model Invoice
  id: uuid key
  user: -> User

task BuildUsers [normal]
  do: Implement user management
  context: user

task BuildInvoices [normal]
  do: Implement invoicing
  context: invoice
`);
  const result = generateTaskGraph(ast);
  assertEqual(result.workItems.length, 2);

  const userItem = result.workItems.find(i => i.name === 'BuildUsers');
  const invoiceItem = result.workItems.find(i => i.name === 'BuildInvoices');

  assert(userItem.context_profile_json.required_context.models.includes('User'));
  assert(!userItem.context_profile_json.required_context.models.includes('Invoice'),
    'user task should not load invoice model');

  assert(invoiceItem.context_profile_json.required_context.models.includes('Invoice'));
  assert(invoiceItem.context_profile_json.required_context.models.includes('User'),
    'invoice task should load user via relation');
});

// ---------------------------------------------------------------------------
// INTEGRATION TEST (full compile)
// ---------------------------------------------------------------------------

console.log('\nINTEGRATION TESTS');
console.log('-'.repeat(60));

test('full compile produces task graph outputs', () => {
  const source = `
model Widget
  id: uuid key
  name: text 1..100
  status: draft | active = draft

service Widgets
  create Widget: auth
  read Widget by id: auth

guard WidgetService
  budget: 3.00/task
  classify: internal

task BuildWidgets [normal]
  do: Implement widget service
  accept: CRUD works
  route: executor
  budget: 3.00
`;
  const result = compile(source);
  assert(result.taskGraph !== undefined, 'should have taskGraph');
  assert(result.contextProfiles !== undefined, 'should have contextProfiles');
  assertEqual(result.taskGraph.workItems.length, 1);
  assert(Object.keys(result.contextProfiles).length >= 2, 'should have profiles for model + service + task');
  assertEqual(result.stats.workItemCount, 1);
});

test('compile without tasks still produces context profiles', () => {
  const source = `
model Item
  id: uuid key
  name: text

service Items
  create Item: auth
  read Item by id: auth

guard ItemService
  budget: 1.00/task
  classify: internal
`;
  const result = compile(source);
  assertEqual(result.taskGraph.workItems.length, 0);
  assert(Object.keys(result.contextProfiles).length >= 2, 'should have model + service profiles');
});

// ---------------------------------------------------------------------------
// SUMMARY
// ---------------------------------------------------------------------------

console.log('\n' + '='.repeat(60));
console.log(`Phase D Tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
