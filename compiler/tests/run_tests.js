#!/usr/bin/env node
// ===========================================================================
// Glyph Compiler — Test Suite
// Phase B6: Example-based and property-based tests
//
// Tests are organized by compiler phase:
//   1. Lexer tests
//   2. Parser tests
//   3. Convention engine tests
//   4. Code generation tests
//   5. End-to-end integration tests
// ===========================================================================

import { lex, TokenType } from '../src/lexer.js';
import { parse } from '../src/parser.js';
import { applyConventions, NAMING_CONVENTIONS } from '../src/conventions.js';
import { generateTypes } from '../src/codegen_types.js';
import { generateSQL } from '../src/codegen_sql.js';
import { generateRoutes } from '../src/codegen_routes.js';
import { generateGuardConfigs } from '../src/codegen_guards.js';
import { compile } from '../src/index.js';

let passed = 0;
let failed = 0;
let skipped = 0;
const errors = [];
let currentSection = '';

function section(name) {
  currentSection = name;
  console.log(`\n${name}`);
  console.log('-'.repeat(60));
}

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    errors.push({ section: currentSection, name, error: err.message });
    console.log(`  ✗ ${name}`);
    console.log(`    → ${err.message}`);
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }
function eq(a, b, msg) {
  if (a !== b) throw new Error(msg || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
function includes(str, sub, msg) {
  if (typeof str !== 'string' || !str.includes(sub))
    throw new Error(msg || `Expected string to include "${sub}"\n  Got: ${typeof str === 'string' ? str.slice(0, 200) : typeof str}`);
}
function notIncludes(str, sub, msg) {
  if (typeof str === 'string' && str.includes(sub))
    throw new Error(msg || `Expected string NOT to include "${sub}"`);
}

// Helper: parse a snippet and return the first block
function parseOne(src) {
  return parse(lex(src)).blocks[0];
}

// ============================================================================
// 1. LEXER TESTS
// ============================================================================

section('LEXER');

test('type definition tokens', () => {
  const tokens = lex('type Money: int >= 0\n');
  const types = tokens.map(t => t.type);
  assert(types.includes('type'));
  assert(types.includes(TokenType.TYPE_NAME));
  assert(types.includes(TokenType.COLON));
  assert(types.includes('int'));
  assert(types.includes(TokenType.GTE));
  assert(types.includes(TokenType.NUMBER));
});

test('indentation produces INDENT/DEDENT', () => {
  const tokens = lex('model User\n  id: uuid\n  name: text\n');
  const types = tokens.map(t => t.type);
  assert(types.includes(TokenType.INDENT));
  assert(types.includes(TokenType.DEDENT));
});

test('rejects odd indentation', () => {
  try { lex('model X\n   id: uuid\n'); assert(false); }
  catch (e) { includes(e.message, 'multiple of 2'); }
});

test('nested indentation', () => {
  // Only one level of nesting in Glyph, but verify stack works
  const tokens = lex('model A\n  id: uuid\nmodel B\n  id: uuid\n');
  const dedents = tokens.filter(t => t.type === TokenType.DEDENT);
  eq(dedents.length, 2);
});

test('arrow operator', () => {
  const tokens = lex('x: -> Customer\n');
  assert(tokens.some(t => t.type === TokenType.ARROW));
});

test('union pipes', () => {
  const tokens = lex('x: a | b | c\n');
  eq(tokens.filter(t => t.type === TokenType.PIPE).length, 2);
});

test('decimal numbers', () => {
  const tok = lex('5.00\n').find(t => t.type === TokenType.NUMBER);
  eq(tok.value, '5.00');
});

test('range operator', () => {
  const tokens = lex('1..200\n');
  assert(tokens.some(t => t.type === TokenType.DOT_DOT));
});

test('wildcard underscore', () => {
  const tokens = lex('_ -> _\n');
  eq(tokens.filter(t => t.type === TokenType.WILDCARD).length, 2);
});

test('underscore in identifiers is NOT wildcard', () => {
  const tokens = lex('all_fields_present\n');
  const wildcards = tokens.filter(t => t.type === TokenType.WILDCARD);
  eq(wildcards.length, 0);
});

test('comments are skipped', () => {
  const tokens = lex('# comment\ntype X: int\n');
  assert(!tokens.some(t => t.value === '# comment'));
  assert(tokens.some(t => t.type === 'type'));
});

test('string literals', () => {
  const tokens = lex('"hello world"\n');
  const str = tokens.find(t => t.type === TokenType.STRING);
  eq(str.value, 'hello world');
});

test('escape block', () => {
  const tokens = lex('```ts\nconst x = 1;\nfunction f() {}\n```\n');
  assert(tokens.some(t => t.type === TokenType.ESCAPE_OPEN));
  assert(tokens.some(t => t.type === TokenType.ESCAPE_CLOSE));
  const content = tokens.find(t => t.type === TokenType.TEXT_CONTENT);
  includes(content.value, 'const x = 1;');
  includes(content.value, 'function f()');
});

test('classification annotation brackets', () => {
  const tokens = lex('[confidential, owned by user]\n');
  assert(tokens.some(t => t.type === TokenType.LBRACKET));
  assert(tokens.some(t => t.type === 'confidential'));
  assert(tokens.some(t => t.type === 'owned'));
  assert(tokens.some(t => t.type === 'by'));
  assert(tokens.some(t => t.type === TokenType.RBRACKET));
});

test('comparison operators', () => {
  const ops = ['>=', '<=', '!=', '>', '<', '='];
  for (const op of ops) {
    const tokens = lex(`x ${op} 5\n`);
    assert(tokens.some(t => t.value === op), `Missing operator ${op}`);
  }
});

test('slash for rate limit', () => {
  const tokens = lex('100/min\n');
  assert(tokens.some(t => t.type === TokenType.SLASH));
});

// ============================================================================
// 2. PARSER TESTS
// ============================================================================

section('PARSER');

test('type definition', () => {
  const t = parseOne('type Money: int >= 0\n');
  eq(t.kind, 'TypeDef');
  eq(t.name, 'Money');
  eq(t.baseType, 'int');
  eq(t.constraints.length, 1);
  eq(t.constraints[0].op, '>=');
  eq(t.constraints[0].value, 0);
});

test('type with pattern constraint', () => {
  const t = parseOne('type Email: text ~ email\n');
  eq(t.constraints[0].op, '~');
  eq(t.constraints[0].value, 'email');
});

test('type with range constraint', () => {
  const t = parseOne('type Name: text 1..200\n');
  eq(t.constraints[0].op, '..');
  eq(t.constraints[0].value[0], 1);
  eq(t.constraints[0].value[1], 200);
});

test('simple model', () => {
  const m = parseOne('model User [internal]\n  id: uuid key\n  name: text\n');
  eq(m.kind, 'ModelDef');
  eq(m.name, 'User');
  eq(m.classification.level, 'internal');
  eq(m.fields.length, 2);
  assert(m.fields[0].isKey);
  eq(m.fields[0].name, 'id');
});

test('model without classification', () => {
  const m = parseOne('model Simple\n  id: uuid key\n');
  eq(m.classification.level, null);
});

test('model with ownership', () => {
  const m = parseOne('model Doc [confidential, owned by user]\n  id: uuid key\n');
  eq(m.classification.level, 'confidential');
  eq(m.classification.ownedBy, 'user');
});

test('model with relation field', () => {
  const m = parseOne('model Invoice\n  customer: -> Customer\n');
  eq(m.fields[0].type.variant, 'relation');
  eq(m.fields[0].type.value.target, 'Customer');
});

test('model with union field and default', () => {
  const m = parseOne('model Item\n  status: draft | active | done = draft\n');
  eq(m.fields[0].type.variant, 'union');
  eq(m.fields[0].type.value.length, 3);
  eq(m.fields[0].defaultValue, 'draft');
});

test('model field with range constraint', () => {
  const m = parseOne('model User\n  name: text 1..200\n');
  const constraint = m.fields[0].modifiers.find(mod => mod.modifier === 'constraint');
  assert(constraint, 'should have constraint modifier');
  eq(constraint.value.op, '..');
});

test('model field optional + unique', () => {
  const m = parseOne('model User\n  email: text unique optional\n');
  assert(m.fields[0].isUnique);
  assert(m.fields[0].isOptional);
});

test('transition block', () => {
  const t = parseOne(`transition Invoice.status
  draft -> sent: require all_fields_present
  sent -> paid: require payment_confirmed
  _ -> _: deny
`);
  eq(t.kind, 'TransitionDef');
  eq(t.model, 'Invoice');
  eq(t.field, 'status');
  eq(t.rules.length, 3);
  eq(t.rules[0].from, 'draft');
  eq(t.rules[0].to, 'sent');
  eq(t.rules[0].actions[0].type, 'require');
  eq(t.rules[2].from, '_');
  eq(t.rules[2].actions[0].type, 'deny');
});

test('transition with multiple actions', () => {
  const t = parseOne(`transition X.status
  paid -> void: require admin, within 30 days
`);
  eq(t.rules[0].actions.length, 2);
  eq(t.rules[0].actions[0].type, 'require');
  eq(t.rules[0].actions[1].type, 'within');
  eq(t.rules[0].actions[1].value.amount, 30);
  eq(t.rules[0].actions[1].value.unit, 'days');
});

test('service definition', () => {
  const s = parseOne(`service Items
  create Item: auth, limit 100/min
  read Item by id: auth
  list Item where status: auth, page 25
`);
  eq(s.kind, 'ServiceDef');
  eq(s.name, 'Items');
  eq(s.actions.length, 3);

  // create
  eq(s.actions[0].verb, 'create');
  eq(s.actions[0].model, 'Item');
  const lim = s.actions[0].modifiers.find(m => m.type === 'limit');
  eq(lim.value.amount, 100);

  // read by id
  eq(s.actions[1].clauses[0].type, 'by');
  eq(s.actions[1].clauses[0].fields[0], 'id');

  // list where + page
  eq(s.actions[2].clauses[0].type, 'where');
  eq(s.actions[2].clauses[0].fields[0], 'status');
  const pg = s.actions[2].modifiers.find(m => m.type === 'page');
  eq(pg.value, 25);
});

test('service transition ref', () => {
  const s = parseOne(`service Items
  create Item: auth
  transition Item.status
`);
  eq(s.actions[1].kind, 'ServiceTransitionRef');
  eq(s.actions[1].model, 'Item');
  eq(s.actions[1].field, 'status');
});

test('rules: deny + require', () => {
  const r = parseOne(`rules Policy
  deny delete Invoice
  Invoice.amount > 10000 requires board_approval
`);
  eq(r.kind, 'RulesDef');
  eq(r.rules.length, 2);
  eq(r.rules[0].kind, 'DenyRule');
  eq(r.rules[0].verb, 'delete');
  eq(r.rules[1].kind, 'RequireRule');
  eq(r.rules[1].requirement, 'board_approval');
});

test('rules: limit rule', () => {
  const r = parseOne(`rules Policy
  Customer.tier = free limits 5 invoices/month
`);
  eq(r.rules[0].kind, 'LimitRule');
  eq(r.rules[0].limit, 5);
  eq(r.rules[0].entity, 'invoices');
  eq(r.rules[0].timeUnit, 'month');
});

test('guard definition', () => {
  const g = parseOne(`guard TestService
  budget: 5.00/task
  classify: confidential
  escalate above 10.00 to strategist
  sanitize: all
`);
  eq(g.kind, 'GuardDef');
  eq(g.name, 'TestService');
  eq(g.directives.length, 4);

  const budget = g.directives.find(d => d.type === 'budget');
  eq(budget.config.amount, 5);
  eq(budget.config.per, 'task');

  const classify = g.directives.find(d => d.type === 'classify');
  eq(classify.config.level, 'confidential');

  const esc = g.directives.find(d => d.type === 'escalate');
  eq(esc.config.threshold, 10);
  eq(esc.config.target, 'strategist');

  const san = g.directives.find(d => d.type === 'sanitize');
  assert(san.config.fields.includes('all'));
});

test('guard with timeout and retry', () => {
  const g = parseOne(`guard Svc
  timeout: 30 seconds
  retry: 3 then fail
`);
  const timeout = g.directives.find(d => d.type === 'timeout');
  eq(timeout.config.amount, 30);
  eq(timeout.config.unit, 'seconds');
  const retry = g.directives.find(d => d.type === 'retry');
  eq(retry.config.count, 3);
  eq(retry.config.fallback, 'fail');
});

test('pipeline definition', () => {
  const p = parseOne(`pipeline OnPaid
  when Invoice.status -> paid
  validate -> credit_balance -> notify customer
  on failure: retry 3 then escalate
`);
  eq(p.kind, 'PipelineDef');
  eq(p.name, 'OnPaid');
  eq(p.trigger.type, 'transition');
  eq(p.trigger.config.model, 'Invoice');
  eq(p.trigger.config.state, 'paid');
  eq(p.steps.length, 3);
  eq(p.errorHandler.type, 'retry');
  eq(p.errorHandler.retries, 3);
  eq(p.errorHandler.fallback, 'escalate');
});

test('pipeline with action trigger', () => {
  const p = parseOne(`pipeline OnCreate
  on create User
  validate -> send_email -> log
`);
  eq(p.trigger.type, 'action');
  eq(p.trigger.config.verb, 'create');
  eq(p.trigger.config.model, 'User');
});

test('task definition', () => {
  const t = parseOne(`task BuildAuth [high]
  do: Implement user authentication
  accept: All endpoints work correctly
  route: executor
  budget: 5.00
`);
  eq(t.kind, 'TaskDef');
  eq(t.name, 'BuildAuth');
  eq(t.priority, 'high');
  eq(t.fields.get('do'), 'Implement user authentication');
  eq(t.fields.get('route'), 'executor');
});

test('escape block', () => {
  const e = parseOne('```ts\nconst x = 42;\n```\n');
  eq(e.kind, 'EscapeBlock');
  includes(e.content, 'const x = 42;');
});

test('multiple blocks in one program', () => {
  const ast = parse(lex(`type Money: int >= 0

model Invoice
  id: uuid key
  amount: int

service Invoices
  create Invoice: auth

guard Invoices
  budget: 5.00/task
`));
  eq(ast.blocks.length, 4);
  eq(ast.blocks[0].kind, 'TypeDef');
  eq(ast.blocks[1].kind, 'ModelDef');
  eq(ast.blocks[2].kind, 'ServiceDef');
  eq(ast.blocks[3].kind, 'GuardDef');
});

// ============================================================================
// 3. CONVENTION ENGINE TESTS
// ============================================================================

section('CONVENTIONS');

test('M1: model defaults to internal classification', () => {
  const ast = parse(lex('model X\n  id: uuid key\n'));
  const { conventions } = applyConventions(ast);
  eq(ast.blocks[0].classification.level, 'internal');
  assert(conventions.applied.some(c => c.convention === 'M1:default-internal'));
});

test('M1: explicit classification is NOT overridden', () => {
  const ast = parse(lex('model X [public]\n  id: uuid key\n'));
  applyConventions(ast);
  eq(ast.blocks[0].classification.level, 'public');
});

test('M2: auto id field when missing', () => {
  const ast = parse(lex('model X\n  name: text\n'));
  applyConventions(ast);
  const idField = ast.blocks[0].fields.find(f => f.name === 'id');
  assert(idField, 'should auto-add id field');
  assert(idField.isKey);
});

test('M2: existing id field is NOT duplicated', () => {
  const ast = parse(lex('model X\n  id: uuid key\n  name: text\n'));
  applyConventions(ast);
  const idFields = ast.blocks[0].fields.filter(f => f.name === 'id');
  eq(idFields.length, 1);
});

test('M3: auto created timestamp when missing', () => {
  const ast = parse(lex('model X\n  id: uuid key\n'));
  applyConventions(ast);
  const created = ast.blocks[0].fields.find(f => f.name === 'created');
  assert(created, 'should auto-add created field');
});

test('M5: uuid key gets auto default', () => {
  const ast = parse(lex('model X\n  id: uuid key\n'));
  applyConventions(ast);
  const idField = ast.blocks[0].fields.find(f => f.name === 'id');
  eq(idField.defaultValue, 'auto');
});

test('S2: service actions default to auth', () => {
  const ast = parse(lex(`model X\n  id: uuid key\n\nservice Items\n  create X: limit 10/min\n\nguard Items\n  budget: 1.00/task\n`));
  applyConventions(ast);
  const action = ast.blocks[1].actions[0];
  assert(action.modifiers.some(m => m.type === 'auth'), 'should have auth modifier');
});

test('S2: explicit public is NOT overridden with auth', () => {
  const ast = parse(lex(`model X\n  id: uuid key\n\nservice Items\n  create X: public\n\nguard Items\n  budget: 1.00/task\n`));
  applyConventions(ast);
  const action = ast.blocks[1].actions[0];
  assert(!action.modifiers.some(m => m.type === 'auth'), 'should not add auth when public');
});

test('S3: mutation actions get default rate limit', () => {
  const ast = parse(lex(`model X\n  id: uuid key\n\nservice Items\n  create X: auth\n\nguard Items\n  budget: 1.00/task\n`));
  applyConventions(ast);
  const action = ast.blocks[1].actions[0];
  assert(action.modifiers.some(m => m.type === 'limit'), 'should have rate limit');
});

test('S3: explicit rate limit is NOT overridden', () => {
  const ast = parse(lex(`model X\n  id: uuid key\n\nservice Items\n  create X: auth, limit 200/hour\n\nguard Items\n  budget: 1.00/task\n`));
  applyConventions(ast);
  const action = ast.blocks[1].actions[0];
  const limits = action.modifiers.filter(m => m.type === 'limit');
  eq(limits.length, 1, 'should not duplicate rate limit');
  eq(limits[0].value.amount, 200);
});

test('S4: list actions get default page size', () => {
  const ast = parse(lex(`model X\n  id: uuid key\n\nservice Items\n  list X: auth\n\nguard Items\n  budget: 1.00/task\n`));
  applyConventions(ast);
  const action = ast.blocks[1].actions[0];
  const page = action.modifiers.find(m => m.type === 'page');
  assert(page, 'should have page modifier');
  eq(page.value, 50);
});

test('S5: read/update/delete get default by-id', () => {
  const ast = parse(lex(`model X\n  id: uuid key\n\nservice Items\n  read X: auth\n  delete X: admin\n\nguard Items\n  budget: 1.00/task\n`));
  applyConventions(ast);
  for (const action of ast.blocks[1].actions) {
    if (action.kind === 'ServiceAction') {
      const byClause = action.clauses.find(c => c.type === 'by');
      assert(byClause, `${action.verb} should have by clause`);
      eq(byClause.fields[0], 'id');
    }
  }
});

test('T1: transition gets wildcard deny if missing', () => {
  const ast = parse(lex(`transition X.status\n  a -> b: require check\n`));
  applyConventions(ast);
  const lastRule = ast.blocks[0].rules[ast.blocks[0].rules.length - 1];
  eq(lastRule.from, '_');
  eq(lastRule.to, '_');
  assert(lastRule.actions.some(a => a.type === 'deny'));
});

test('T1: existing wildcard deny is NOT duplicated', () => {
  const ast = parse(lex(`transition X.status\n  a -> b: require check\n  _ -> _: deny\n`));
  applyConventions(ast);
  const denyRules = ast.blocks[0].rules.filter(r =>
    r.from === '_' && r.to === '_' && r.actions.some(a => a.type === 'deny'));
  eq(denyRules.length, 1);
});

test('T2: transitions get auto audit logging', () => {
  const ast = parse(lex(`transition X.status\n  a -> b: require check\n`));
  applyConventions(ast);
  // The a->b rule should have 'log' added
  assert(ast.blocks[0].rules[0].actions.some(a => a.type === 'log'));
});

test('G1: guard defaults audit to mutations', () => {
  const ast = parse(lex(`guard Svc\n  budget: 1.00/task\n`));
  applyConventions(ast);
  const audit = ast.blocks[0].directives.find(d => d.type === 'audit');
  assert(audit);
  eq(audit.config.scope, 'mutations');
});

test('G2: guard defaults timeout to 60s', () => {
  const ast = parse(lex(`guard Svc\n  budget: 1.00/task\n`));
  applyConventions(ast);
  const timeout = ast.blocks[0].directives.find(d => d.type === 'timeout');
  assert(timeout);
});

test('G3: guard defaults retry to 2 then fail', () => {
  const ast = parse(lex(`guard Svc\n  budget: 1.00/task\n`));
  applyConventions(ast);
  const retry = ast.blocks[0].directives.find(d => d.type === 'retry');
  assert(retry);
  eq(retry.config.count, 2);
  eq(retry.config.fallback, 'fail');
});

test('P1: pipeline defaults error handler', () => {
  const ast = parse(lex(`pipeline OnX\n  on create X\n  validate -> process\n`));
  applyConventions(ast);
  assert(ast.blocks[0].errorHandler, 'should have error handler');
  eq(ast.blocks[0].errorHandler.type, 'retry');
  eq(ast.blocks[0].errorHandler.retries, 3);
});

test('naming conventions are deterministic', () => {
  eq(NAMING_CONVENTIONS.routePath('Invoices'), '/api/invoices');
  eq(NAMING_CONVENTIONS.tableName('Invoice'), 'invoices');
  eq(NAMING_CONVENTIONS.tableName('UserProfile'), 'user_profiles');
  eq(NAMING_CONVENTIONS.routerVar('Invoices'), 'invoicesRouter');
  eq(NAMING_CONVENTIONS.schemaName('Invoice'), 'InvoiceSchema');
});

test('convention report tracks all applied defaults', () => {
  const ast = parse(lex('model X\n  name: text\n'));
  const { conventions } = applyConventions(ast);
  const summary = conventions.summary();
  assert(summary.total > 0, 'should have applied conventions');
  assert(summary.byConvention['M1:default-internal'] >= 1);
  assert(summary.byConvention['M2:auto-id'] >= 1);
  assert(summary.byConvention['M3:auto-timestamp'] >= 1);
});

// ============================================================================
// 4. CODE GENERATION TESTS
// ============================================================================

section('CODEGEN: TypeScript + Zod');

test('generates TypeScript interface from model', () => {
  const ast = parse(lex('model User\n  id: uuid key\n  name: text\n  active: bool\n'));
  const code = generateTypes(ast);
  includes(code, 'export interface User');
  includes(code, 'id: string');
  includes(code, 'name: string');
  includes(code, 'active: boolean');
});

test('generates Zod schema from model', () => {
  const ast = parse(lex('model User\n  id: uuid key\n  name: text\n'));
  const code = generateTypes(ast);
  includes(code, 'export const UserSchema = z.object');
  includes(code, 'z.string().uuid()');
});

test('generates Create and Update schemas', () => {
  const ast = parse(lex('model User\n  id: uuid key\n  name: text\n  active: bool\n'));
  const code = generateTypes(ast);
  includes(code, 'UserCreateSchema');
  includes(code, 'UserUpdateSchema');
  includes(code, '.optional()');
});

test('generates custom type alias and schema', () => {
  const ast = parse(lex('type Money: int >= 0\n'));
  const code = generateTypes(ast);
  includes(code, 'export type Money = number');
  includes(code, 'export const MoneySchema = z.number().int().min(0)');
});

test('generates union/enum type', () => {
  const ast = parse(lex('model Item\n  status: draft | active | done\n'));
  const code = generateTypes(ast);
  includes(code, "z.enum([");
  includes(code, "'draft'");
  includes(code, "'active'");
});

test('generates optional field correctly', () => {
  const ast = parse(lex('model User\n  bio: text optional\n'));
  const code = generateTypes(ast);
  includes(code, 'bio?:');
  includes(code, '.optional().nullable()');
});

test('generates relation as string id', () => {
  const ast = parse(lex('model Invoice\n  customer: -> Customer\n'));
  const code = generateTypes(ast);
  includes(code, 'customer: string');
});

test('includes classification in JSDoc', () => {
  const ast = parse(lex('model Secret [confidential]\n  id: uuid key\n'));
  const code = generateTypes(ast);
  includes(code, '@classification confidential');
});

section('CODEGEN: SQL DDL');

test('generates CREATE TABLE', () => {
  const ast = parse(lex('model User\n  id: uuid key\n  name: text\n'));
  const sql = generateSQL(ast);
  includes(sql, 'CREATE TABLE users');
  includes(sql, 'id UUID');
  includes(sql, 'name TEXT NOT NULL');
  includes(sql, 'PRIMARY KEY (id)');
});

test('generates foreign key constraint', () => {
  const ast = parse(lex('model Invoice\n  id: uuid key\n  customer: -> Customer\n'));
  const sql = generateSQL(ast);
  includes(sql, 'customer_id UUID NOT NULL');
  includes(sql, 'FOREIGN KEY (customer_id) REFERENCES customers(id)');
});

test('generates CHECK constraint for union/enum', () => {
  const ast = parse(lex('model Item\n  id: uuid key\n  status: draft | active | done = draft\n'));
  const sql = generateSQL(ast);
  includes(sql, "CHECK (status IN ('draft', 'active', 'done'))");
  includes(sql, "DEFAULT 'draft'");
});

test('generates unique constraint', () => {
  const ast = parse(lex('model User\n  id: uuid key\n  email: text unique\n'));
  const sql = generateSQL(ast);
  includes(sql, 'UNIQUE (email)');
});

test('generates RLS for owned model', () => {
  const ast = parse(lex('model Doc [confidential, owned by user]\n  id: uuid key\n'));
  const sql = generateSQL(ast);
  includes(sql, 'ENABLE ROW LEVEL SECURITY');
  includes(sql, 'owner_policy');
  includes(sql, 'current_setting');
});

test('generates audit log table for confidential', () => {
  const ast = parse(lex('model Secret [confidential]\n  id: uuid key\n'));
  const sql = generateSQL(ast);
  includes(sql, 'audit_log');
  includes(sql, 'audit_trigger');
});

test('generates updated_at trigger', () => {
  const ast = parse(lex('model User\n  id: uuid key\n'));
  const sql = generateSQL(ast);
  includes(sql, 'updated_at TIMESTAMPTZ');
  includes(sql, 'update_users_updated_at');
});

test('generates transition DDL', () => {
  const ast = parse(lex(`model X\n  id: uuid key\n  status: a | b\n\ntransition X.status\n  a -> b: require check\n  _ -> _: deny\n`));
  const sql = generateSQL(ast);
  includes(sql, 'x_status_transitions');
  includes(sql, 'from_state TEXT');
  includes(sql, 'to_state TEXT');
  includes(sql, 'transition_x_status');
});

test('generates index for relation fields', () => {
  const ast = parse(lex('model Invoice\n  id: uuid key\n  customer: -> Customer\n'));
  const sql = generateSQL(ast);
  includes(sql, 'idx_invoices_customer_id');
});

section('CODEGEN: Express Routes');

test('generates router for service', () => {
  const ast = parse(lex(`model Item\n  id: uuid key\n\nservice Items\n  create Item: auth\n  read Item by id: auth\n\nguard Items\n  budget: 1.00/task\n`));
  const routes = generateRoutes(ast);
  includes(routes, 'express.Router()');
  includes(routes, ".post('/'");
  includes(routes, ".get('/:id'");
});

test('generates rate limit middleware', () => {
  const ast = parse(lex(`model X\n  id: uuid key\n\nservice Items\n  create X: auth, limit 100/min\n\nguard Items\n  budget: 1.00/task\n`));
  const routes = generateRoutes(ast);
  includes(routes, 'rateLimit(');
  includes(routes, 'max: 100');
});

test('generates paginated list endpoint', () => {
  const ast = parse(lex(`model X\n  id: uuid key\n\nservice Items\n  list X where status: auth, page 25\n\nguard Items\n  budget: 1.00/task\n`));
  const routes = generateRoutes(ast);
  includes(routes, 'pagination');
  includes(routes, 'limit = 25');
});

test('generates auth middleware', () => {
  const ast = parse(lex(`model X\n  id: uuid key\n\nservice Items\n  read X by id: auth\n\nguard Items\n  budget: 1.00/task\n`));
  const routes = generateRoutes(ast);
  includes(routes, 'authenticate');
});

test('generates admin authorization', () => {
  const ast = parse(lex(`model X\n  id: uuid key\n\nservice Items\n  delete X by id: admin\n\nguard Items\n  budget: 1.00/task\n`));
  const routes = generateRoutes(ast);
  includes(routes, "authorize('admin')");
});

test('generates transition endpoint', () => {
  const ast = parse(lex(`model X\n  id: uuid key\n  status: a | b\n\nservice Items\n  create X: auth\n  transition X.status\n\nguard Items\n  budget: 1.00/task\n`));
  const routes = generateRoutes(ast);
  includes(routes, '/transition');
  includes(routes, 'transition_x_status');
});

test('generates router registry', () => {
  const ast = parse(lex(`model X\n  id: uuid key\n\nservice Items\n  create X: auth\n\nguard Items\n  budget: 1.00/task\n`));
  const routes = generateRoutes(ast);
  includes(routes, 'export const routers');
  includes(routes, "'/items'");
});

section('CODEGEN: Guard Configs');

test('generates guard JSON with budget', () => {
  const ast = parse(lex(`guard Svc\n  budget: 5.00/task\n`));
  const json = JSON.parse(generateGuardConfigs(ast));
  eq(json.Svc.directives.budget.max_per_unit, 5);
  eq(json.Svc.directives.budget.unit, 'task');
});

test('generates classification with security flags', () => {
  const ast = parse(lex(`guard Svc\n  classify: confidential\n`));
  const json = JSON.parse(generateGuardConfigs(ast));
  eq(json.Svc.directives.classification.level, 'confidential');
  eq(json.Svc.directives.classification.encryption_at_rest, true);
  eq(json.Svc.directives.classification.audit_access, true);
});

test('generates escalation config', () => {
  const ast = parse(lex(`guard Svc\n  escalate above 10.00 to strategist\n`));
  const json = JSON.parse(generateGuardConfigs(ast));
  eq(json.Svc.directives.escalation.threshold, 10);
  eq(json.Svc.directives.escalation.target_tier, 'strategist');
});

test('generates sanitization config', () => {
  const ast = parse(lex(`guard Svc\n  sanitize: all\n`));
  const json = JSON.parse(generateGuardConfigs(ast));
  eq(json.Svc.directives.sanitization.mode, 'all');
  eq(json.Svc.directives.sanitization.pii_detection, true);
});

test('generates retry config with fallback', () => {
  const ast = parse(lex(`guard Svc\n  retry: 3 then escalate\n`));
  const json = JSON.parse(generateGuardConfigs(ast));
  eq(json.Svc.directives.retry.max_retries, 3);
  eq(json.Svc.directives.retry.fallback, 'escalate');
});

test('generates timeout in seconds', () => {
  const ast = parse(lex(`guard Svc\n  timeout: 2 minutes\n`));
  const json = JSON.parse(generateGuardConfigs(ast));
  eq(json.Svc.directives.timeout.duration_seconds, 120);
});

test('generates audit scope config', () => {
  const ast = parse(lex(`guard Svc\n  audit: all\n`));
  const json = JSON.parse(generateGuardConfigs(ast));
  eq(json.Svc.directives.audit.log_reads, true);
  eq(json.Svc.directives.audit.log_mutations, true);
});

// ============================================================================
// 4b. PHASE C: Rules SQL, Rules Middleware, Pipelines
// ============================================================================

section('CODEGEN: Rules → SQL');

test('generates deny trigger', () => {
  const ast = parse(lex(`rules Policy\n  deny delete Invoice\n`));
  const sql = generateSQL(ast);
  includes(sql, 'deny_delete_invoices');
  includes(sql, 'BEFORE DELETE ON invoices');
  includes(sql, 'RAISE EXCEPTION');
});

test('generates require trigger with approval check', () => {
  const ast = parse(lex(`rules Policy\n  Invoice.amount > 10000 requires board_approval\n`));
  const sql = generateSQL(ast);
  includes(sql, 'require_board_approval');
  includes(sql, 'NEW.amount > 10000');
  includes(sql, 'approvals');
  includes(sql, 'BEFORE INSERT OR UPDATE ON invoices');
});

test('generates limit tracking table and trigger', () => {
  const ast = parse(lex(`rules Policy\n  Customer.tier = free limits 5 invoices/month\n`));
  const sql = generateSQL(ast);
  includes(sql, 'customers_invoices_limits');
  includes(sql, 'source_id UUID');
  includes(sql, 'period_start');
  includes(sql, 'enforce_invoices_limit_customers');
  includes(sql, 'v_count > 5');
});

section('CODEGEN: Rules → Middleware');

import { generateRulesMiddleware } from '../src/codegen_rules.js';

test('generates deny middleware', () => {
  const ast = parse(lex(`rules Policy\n  deny delete Invoice\n`));
  const code = generateRulesMiddleware(ast);
  includes(code, 'denyDeleteInvoice');
  includes(code, "req.method === 'DELETE'");
  includes(code, '403');
  includes(code, 'RULE_DENIED');
});

test('generates require middleware with approval check', () => {
  const ast = parse(lex(`rules Policy\n  Invoice.amount > 10000 requires board_approval\n`));
  const code = generateRulesMiddleware(ast);
  includes(code, 'requireBoard_approvalForInvoice');
  includes(code, 'APPROVAL_REQUIRED');
  includes(code, 'board_approval');
  includes(code, 'pendingApprovals');
});

test('generates limit middleware with rate check', () => {
  const ast = parse(lex(`rules Policy\n  Customer.tier = free limits 5 invoices/month\n`));
  const code = generateRulesMiddleware(ast);
  includes(code, 'enforceInvoicesLimitForCustomer');
  includes(code, '429');
  includes(code, 'RATE_LIMIT_EXCEEDED');
  includes(code, 'limit: 5');
});

test('generates middleware registry by model', () => {
  const ast = parse(lex(`rules Policy\n  deny delete Invoice\n  Invoice.amount > 10000 requires board_approval\n`));
  const code = generateRulesMiddleware(ast);
  includes(code, 'rulesMiddleware');
  includes(code, 'Invoice:');
});

test('generates comparison helper', () => {
  const ast = parse(lex(`rules Policy\n  deny delete Invoice\n`));
  const code = generateRulesMiddleware(ast);
  includes(code, 'function compare(');
});

test('returns null when no rules', () => {
  const ast = parse(lex(`model X\n  id: uuid key\n`));
  const code = generateRulesMiddleware(ast);
  eq(code, null);
});

section('CODEGEN: Pipelines');

import { generatePipelines } from '../src/codegen_pipelines.js';

test('generates pipeline handler for transition trigger', () => {
  const ast = parse(lex(`pipeline OnPaid\n  when Invoice.status -> paid\n  validate -> process -> notify_customer\n  on failure: retry 3 then escalate\n`));
  const code = generatePipelines(ast);
  includes(code, 'handleOnPaid');
  includes(code, "const pipelineSteps = ['validate', 'process', 'notify_customer']");
  includes(code, 'MAX_RETRIES = 3');
  includes(code, 'escalate');
});

test('generates pipeline handler for action trigger', () => {
  const ast = parse(lex(`pipeline OnCreate\n  on create User\n  validate -> send_email -> log\n`));
  const code = generatePipelines(ast);
  includes(code, 'handleOnCreate');
  includes(code, 'validate');
  includes(code, 'send_email');
});

test('generates step stubs and registerStep', () => {
  const ast = parse(lex(`pipeline OnX\n  on create X\n  step_a -> step_b\n`));
  const code = generatePipelines(ast);
  includes(code, 'const steps = {');
  includes(code, 'step_a:');
  includes(code, 'step_b:');
  includes(code, 'registerStep');
});

test('generates event registration', () => {
  const ast = parse(lex(`pipeline OnPaid\n  when Invoice.status -> paid\n  validate -> process\n  on failure: retry 2 then fail\n`));
  const code = generatePipelines(ast);
  includes(code, 'registerPipelines');
  includes(code, 'invoice.status.paid');
});

test('generates pipeline with rollback error strategy', () => {
  const ast = parse(lex(`pipeline OnCreate\n  on create User\n  step_a -> step_b\n  on failure: rollback\n`));
  const code = generatePipelines(ast);
  includes(code, 'rollback');
  includes(code, 'completedSteps.length - 1');
  includes(code, 'rolled_back');
});

test('generates pipeline manifest metadata', () => {
  const ast = parse(lex(`pipeline OnX\n  on create X\n  validate -> process\n  on failure: retry 3 then escalate\n`));
  const code = generatePipelines(ast);
  includes(code, 'pipelineManifest');
  includes(code, '"name": "OnX"');
  includes(code, '"retries": 3');
});

test('returns null when no pipelines', () => {
  const ast = parse(lex(`model X\n  id: uuid key\n`));
  const code = generatePipelines(ast);
  eq(code, null);
});

// ============================================================================
// 5. END-TO-END INTEGRATION TESTS
// ============================================================================

section('END-TO-END');

test('compiles minimal valid service', () => {
  const result = compile(`model Item
  id: uuid key
  name: text

service Items
  create Item: auth

guard Items
  budget: 1.00/task
`);
  assert(result.types.length > 0, 'should generate types');
  assert(result.sql.length > 0, 'should generate SQL');
  assert(result.routes.length > 0, 'should generate routes');
  assert(result.guards.length > 0, 'should generate guards');
  assert(result.stats.duration >= 0, 'should track timing');
  assert(result.conventions.total > 0, 'should apply conventions');
});

test('enforces guard co-location', () => {
  try {
    compile(`model Item\n  id: uuid key\n\nservice Items\n  create Item: auth\n`);
    assert(false, 'should throw');
  } catch (e) {
    includes(e.message, 'no guard block');
  }
});

test('skip-guard-check option works', () => {
  const result = compile(
    `model Item\n  id: uuid key\n\nservice Items\n  create Item: auth\n`,
    { skipGuardCheck: true }
  );
  assert(result.types.length > 0);
});

test('escape blocks are collected', () => {
  const result = compile(`model X
  id: uuid key

service Items
  create X: auth

guard Items
  budget: 1.00/task

\`\`\`ts
const x = 42;
export function custom() { return x; }
\`\`\`
`);
  eq(result.escapeBlocks.length, 1);
  includes(result.escapeBlocks[0], 'const x = 42');
});

test('compiles the canonical invoice example', () => {
  const source = `type Money: int >= 0
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
`;

  const result = compile(source);

  // Types
  includes(result.types, 'export interface Customer');
  includes(result.types, 'export interface Invoice');
  includes(result.types, 'MoneySchema');
  includes(result.types, 'EmailSchema');
  includes(result.types, 'InvoiceCreateSchema');

  // SQL
  includes(result.sql, 'CREATE TABLE customers');
  includes(result.sql, 'CREATE TABLE invoices');
  includes(result.sql, 'ROW LEVEL SECURITY');
  includes(result.sql, 'audit_log');
  includes(result.sql, 'invoice_status_transitions');

  // Routes
  includes(result.routes, 'invoicesRouter');
  includes(result.routes, "post('/'");
  includes(result.routes, '/transition');
  includes(result.routes, 'rateLimit');

  // Guards
  const guards = JSON.parse(result.guards);
  assert(guards.InvoiceService, 'should have InvoiceService guard');
  eq(guards.InvoiceService.directives.budget.max_per_unit, 5);
  eq(guards.InvoiceService.directives.classification.level, 'confidential');

  // Stats
  assert(result.stats.blockCount >= 8, `expected 8+ blocks, got ${result.stats.blockCount}`);
  assert(result.conventions.total > 0, 'should have applied conventions');

  console.log(`    → ${result.stats.blockCount} blocks, ${result.stats.tokenCount} tokens, ${result.stats.duration}ms`);
  console.log(`    → ${result.conventions.total} conventions applied`);
});

test('deterministic output (L5): same input → same output', () => {
  const src = `model X\n  id: uuid key\n  name: text\n\nservice Items\n  create X: auth\n\nguard Items\n  budget: 1.00/task\n`;
  const r1 = compile(src);
  const r2 = compile(src);
  eq(r1.types, r2.types, 'types should be identical');
  eq(r1.sql, r2.sql, 'sql should be identical');
  eq(r1.routes, r2.routes, 'routes should be identical');
  eq(r1.guards, r2.guards, 'guards should be identical');
});

// ============================================================================
// SUMMARY
// ============================================================================

console.log('\n' + '='.repeat(60));
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));

if (errors.length > 0) {
  console.log('\nFAILURES:');
  for (const { section, name, error } of errors) {
    console.log(`  [${section}] ${name}`);
    console.log(`    → ${error}`);
  }
}

process.exit(failed > 0 ? 1 : 0);
