// ===========================================================================
// Glyph Convention Engine — Ruby-Inspired Defaults
// Phase B5: Convention over Configuration
//
// L2: Defaults eliminate the common case. Tokens are spent only to deviate.
//
// This module applies conventions to the AST after parsing and before
// code generation. It fills in everything the developer didn't specify,
// producing a "fully resolved" AST where all defaults are explicit.
//
// Philosophy: if 80% of services need auth, make auth the default.
// Only spend a token ('public') to opt out.
// ===========================================================================

import * as AST from './ast.js';

/**
 * Apply all conventions to a parsed AST.
 * Returns a new AST with all defaults resolved — deterministic (L5).
 *
 * @param {AST.Program} ast
 * @returns {{ ast: AST.Program, conventions: ConventionReport }}
 */
export function applyConventions(ast) {
  const report = new ConventionReport();

  for (const block of ast.blocks) {
    switch (block.kind) {
      case 'ModelDef':
        applyModelConventions(block, report);
        break;
      case 'ServiceDef':
        applyServiceConventions(block, ast, report);
        break;
      case 'GuardDef':
        applyGuardConventions(block, report);
        break;
      case 'TransitionDef':
        applyTransitionConventions(block, report);
        break;
      case 'PipelineDef':
        applyPipelineConventions(block, report);
        break;
    }
  }

  return { ast, conventions: report };
}

// ---------------------------------------------------------------------------
// Convention Report — tracks every default applied for auditability
// ---------------------------------------------------------------------------

class ConventionReport {
  constructor() {
    this.applied = [];  // { block, field, convention, value }
  }

  add(block, field, convention, value) {
    this.applied.push({ block, field, convention, value });
  }

  summary() {
    const byConvention = {};
    for (const c of this.applied) {
      byConvention[c.convention] = (byConvention[c.convention] || 0) + 1;
    }
    return {
      total: this.applied.length,
      byConvention,
      details: this.applied,
    };
  }
}

// ---------------------------------------------------------------------------
// Model Conventions
// ---------------------------------------------------------------------------

function applyModelConventions(model, report) {
  // Convention M1: Default classification is 'internal' (not public)
  // Rationale: P1 (deny by default) — data is private until explicitly public
  if (!model.classification.level) {
    model.classification.level = 'internal';
    report.add(model.name, 'classification', 'M1:default-internal',
      'Classification defaulted to internal (P1: deny by default)');
  }

  // Convention M2: If model has no 'id' field, one is inferred
  const hasId = model.fields.some(f => f.name === 'id');
  if (!hasId) {
    const idField = new AST.FieldDef(
      'id',
      new AST.FieldType('base', 'uuid'),
      [
        new AST.FieldModifier('key', null),
        new AST.FieldModifier('default', 'auto'),
      ]
    );
    model.fields.unshift(idField);
    report.add(model.name, 'id', 'M2:auto-id',
      'UUID primary key auto-generated');
  }

  // Convention M3: If model has no 'created' field, one is inferred
  const hasCreated = model.fields.some(f => f.name === 'created');
  if (!hasCreated) {
    const createdField = new AST.FieldDef(
      'created',
      new AST.FieldType('base', 'timestamp'),
      [new AST.FieldModifier('default', 'now')]
    );
    model.fields.push(createdField);
    report.add(model.name, 'created', 'M3:auto-timestamp',
      'Created timestamp auto-generated with default now');
  }

  // Convention M4: All fields are required by default (optional is explicit)
  // This is already enforced by the absence of 'optional' modifier.
  // We just report it for auditability.
  for (const field of model.fields) {
    if (!field.isOptional && !field.isKey && field.defaultValue === null) {
      report.add(model.name, field.name, 'M4:required-by-default',
        `Field '${field.name}' is required (L2: optional is explicit)`);
    }
  }

  // Convention M5: UUID key fields get auto-generation default
  for (const field of model.fields) {
    if (field.isKey && field.type.variant === 'base' && field.type.value === 'uuid' && !field.defaultValue) {
      field.modifiers.push(new AST.FieldModifier('default', 'auto'));
      report.add(model.name, field.name, 'M5:uuid-auto',
        'UUID key field gets auto-generation default');
    }
  }
}

// ---------------------------------------------------------------------------
// Service Conventions
// ---------------------------------------------------------------------------

function applyServiceConventions(service, ast, report) {
  // Convention S1: Infer model from service name
  // "Invoices" service → operates on "Invoice" model
  // This is already handled by explicit model names in actions,
  // but we validate consistency.
  const expectedModel = service.name.replace(/s$/, ''); // naive singularize

  for (const action of service.actions) {
    if (action.kind === 'ServiceAction') {
      // Convention S2: Default auth for all actions
      // If no auth-related modifier is present, add 'auth'
      const hasAuthMod = action.modifiers.some(m =>
        ['auth', 'public', 'admin', 'role'].includes(m.type));
      if (!hasAuthMod) {
        action.modifiers.unshift(new AST.ServiceModifier('auth', null));
        report.add(service.name, `${action.verb} ${action.model}`, 'S2:default-auth',
          'Auth required by default (P1: deny by default)');
      }

      // Convention S3: Default rate limit for create/update actions
      const hasMutation = ['create', 'update', 'delete'].includes(action.verb);
      const hasRateLimit = action.modifiers.some(m => m.type === 'limit');
      if (hasMutation && !hasRateLimit) {
        action.modifiers.push(new AST.ServiceModifier('limit', { amount: 60, unit: 'minute' }));
        report.add(service.name, `${action.verb} ${action.model}`, 'S3:default-rate-limit',
          'Mutation rate limit defaulted to 60/minute');
      }

      // Convention S4: Default pagination for list actions
      const hasPage = action.modifiers.some(m => m.type === 'page');
      if (action.verb === 'list' && !hasPage) {
        action.modifiers.push(new AST.ServiceModifier('page', 50));
        report.add(service.name, `list ${action.model}`, 'S4:default-page-size',
          'Page size defaulted to 50');
      }

      // Convention S5: Infer 'by id' for read/update/delete if no clause
      const needsBy = ['read', 'update', 'delete'].includes(action.verb);
      const hasByClause = action.clauses.some(c => c.type === 'by');
      if (needsBy && !hasByClause) {
        action.clauses.unshift(new AST.ServiceClause('by', ['id']));
        report.add(service.name, `${action.verb} ${action.model}`, 'S5:default-by-id',
          'Lookup by id inferred');
      }
    }
  }

  // Convention S6: Route path inferred from service name
  // "Invoices" → /api/invoices
  // This is applied in the routes codegen, but we note it here.
  report.add(service.name, 'route', 'S6:route-from-name',
    `Route path: /api/${toKebab(service.name)}`);
}

// ---------------------------------------------------------------------------
// Guard Conventions
// ---------------------------------------------------------------------------

function applyGuardConventions(guard, report) {
  const directiveTypes = new Set(guard.directives.map(d => d.type));

  // Convention G1: Default audit scope is 'mutations' if not specified
  if (!directiveTypes.has('audit')) {
    guard.directives.push(new AST.GuardDirective('audit', { scope: 'mutations' }));
    report.add(guard.name, 'audit', 'G1:default-audit-mutations',
      'Audit scope defaulted to mutations');
  }

  // Convention G2: Default timeout is 60 seconds if not specified
  if (!directiveTypes.has('timeout')) {
    guard.directives.push(new AST.GuardDirective('timeout',
      new AST.Duration(60, 'seconds')));
    report.add(guard.name, 'timeout', 'G2:default-timeout',
      'Timeout defaulted to 60 seconds');
  }

  // Convention G3: Default retry is 2 then fail if not specified
  if (!directiveTypes.has('retry')) {
    guard.directives.push(new AST.GuardDirective('retry', { count: 2, fallback: 'fail' }));
    report.add(guard.name, 'retry', 'G3:default-retry',
      'Retry defaulted to 2 attempts then fail');
  }

  // Convention G4: Classification defaults to service-level if not specified
  if (!directiveTypes.has('classify')) {
    guard.directives.push(new AST.GuardDirective('classify', { level: 'internal' }));
    report.add(guard.name, 'classify', 'G4:default-classify-internal',
      'Classification defaulted to internal');
  }
}

// ---------------------------------------------------------------------------
// Transition Conventions
// ---------------------------------------------------------------------------

function applyTransitionConventions(transition, report) {
  // Convention T1: If no wildcard deny rule exists, append one
  // P1 (deny by default) — transitions not explicitly allowed are denied
  const hasWildcardDeny = transition.rules.some(r =>
    r.from === '_' && r.to === '_' && r.actions.some(a => a.type === 'deny'));

  if (!hasWildcardDeny) {
    transition.rules.push(new AST.TransitionRule('_', '_', [
      new AST.TransitionAction('deny', null)
    ]));
    report.add(`${transition.model}.${transition.field}`, 'wildcard', 'T1:deny-by-default',
      'Wildcard deny rule added (P1: deny by default)');
  }

  // Convention T2: All transitions get audit logging
  for (const rule of transition.rules) {
    const hasLog = rule.actions.some(a => a.type === 'log');
    if (!hasLog && !rule.actions.some(a => a.type === 'deny')) {
      rule.actions.push(new AST.TransitionAction('log', null));
      report.add(`${transition.model}.${transition.field}`,
        `${rule.from}->${rule.to}`, 'T2:auto-audit-transition',
        'Transition audit logging added automatically');
    }
  }
}

// ---------------------------------------------------------------------------
// Pipeline Conventions
// ---------------------------------------------------------------------------

function applyPipelineConventions(pipeline, report) {
  // Convention P1: Default error handler is retry 3 then escalate
  if (!pipeline.errorHandler) {
    pipeline.errorHandler = new AST.ErrorStrategy('retry', 3, 'escalate');
    report.add(pipeline.name, 'errorHandler', 'P1:default-error-handler',
      'Error handler defaulted to retry 3 then escalate');
  }
}

// ---------------------------------------------------------------------------
// Naming Conventions
// ---------------------------------------------------------------------------

/**
 * Convention map for naming inference.
 * These are deterministic (L5) and documented.
 */
export const NAMING_CONVENTIONS = {
  // Service name → route path
  routePath: (serviceName) => `/api/${toKebab(serviceName)}`,

  // Model name → table name (snake_case, pluralized)
  tableName: (modelName) => toSnake(modelName) + 's',

  // Model name → TypeScript file
  typeFile: (modelName) => `${toSnake(modelName)}.types.ts`,

  // Service name → router variable
  routerVar: (serviceName) => serviceName.charAt(0).toLowerCase() + serviceName.slice(1) + 'Router',

  // Model name → Zod schema name
  schemaName: (modelName) => `${modelName}Schema`,

  // Guard name → config file
  guardFile: (guardName) => `${toSnake(guardName)}.guard.json`,
};

function toSnake(name) {
  return name.replace(/([A-Z])/g, (m, p, i) => (i > 0 ? '_' : '') + m.toLowerCase());
}

function toKebab(name) {
  return toSnake(name).replace(/_/g, '-');
}
