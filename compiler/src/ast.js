// ===========================================================================
// Glyph AST — Node definitions
// Phase B: Compiler Core
//
// L4: The type system is the program. Each AST node carries enough
// information to generate types, validators, schema, routes, and docs.
// ===========================================================================

export class Program {
  constructor(blocks) {
    this.kind = 'Program';
    this.blocks = blocks; // TopLevelBlock[]
  }
}

// ---------------------------------------------------------------------------
// Type Definitions
// ---------------------------------------------------------------------------

export class TypeDef {
  constructor(name, baseType, constraints) {
    this.kind = 'TypeDef';
    this.name = name;           // string (PascalCase)
    this.baseType = baseType;   // string
    this.constraints = constraints; // TypeConstraint[]
  }
}

export class TypeConstraint {
  constructor(op, value) {
    this.kind = 'TypeConstraint';
    this.op = op;     // '>=' | '<=' | '>' | '<' | '~' | '..'
    this.value = value; // number | string | [number, number] for range
  }
}

// ---------------------------------------------------------------------------
// Model Definitions
// ---------------------------------------------------------------------------

export class ModelDef {
  constructor(name, classification, fields) {
    this.kind = 'ModelDef';
    this.name = name;               // string (PascalCase)
    this.classification = classification; // Classification
    this.fields = fields;           // FieldDef[]
  }
}

export class Classification {
  constructor(level, ownedBy) {
    this.kind = 'Classification';
    this.level = level;    // 'public' | 'internal' | 'confidential' | 'restricted' | null
    this.ownedBy = ownedBy; // string | null
  }
}

export class FieldDef {
  constructor(name, type, modifiers) {
    this.kind = 'FieldDef';
    this.name = name;         // string
    this.type = type;         // FieldType
    this.modifiers = modifiers; // FieldModifier[]
  }

  get isKey() { return this.modifiers.some(m => m.modifier === 'key'); }
  get isUnique() { return this.modifiers.some(m => m.modifier === 'unique'); }
  get isOptional() { return this.modifiers.some(m => m.modifier === 'optional'); }
  get isIndex() { return this.modifiers.some(m => m.modifier === 'index'); }
  get defaultValue() {
    const d = this.modifiers.find(m => m.modifier === 'default');
    return d ? d.value : null;
  }
}

export class FieldType {
  constructor(variant, value) {
    this.kind = 'FieldType';
    this.variant = variant; // 'base' | 'relation' | 'union' | 'ref'
    this.value = value;     // string | string[] | { target: string }
  }
}

export class FieldModifier {
  constructor(modifier, value) {
    this.kind = 'FieldModifier';
    this.modifier = modifier; // 'key' | 'unique' | 'optional' | 'index' | 'default' | 'constraint'
    this.value = value;       // any
  }
}

// ---------------------------------------------------------------------------
// Transition Definitions
// ---------------------------------------------------------------------------

export class TransitionDef {
  constructor(model, field, rules) {
    this.kind = 'TransitionDef';
    this.model = model;   // string
    this.field = field;   // string
    this.rules = rules;   // TransitionRule[]
  }
}

export class TransitionRule {
  constructor(from, to, actions) {
    this.kind = 'TransitionRule';
    this.from = from;     // string | '_' (wildcard)
    this.to = to;         // string | '_' (wildcard)
    this.actions = actions; // TransitionAction[]
  }
}

export class TransitionAction {
  constructor(type, value) {
    this.kind = 'TransitionAction';
    this.type = type;   // 'require' | 'deny' | 'within' | 'notify' | 'log' | 'custom'
    this.value = value; // string | Duration | null
  }
}

export class Duration {
  constructor(amount, unit) {
    this.kind = 'Duration';
    this.amount = amount; // number
    this.unit = unit;     // string
  }
}

// ---------------------------------------------------------------------------
// Service Definitions
// ---------------------------------------------------------------------------

export class ServiceDef {
  constructor(name, actions) {
    this.kind = 'ServiceDef';
    this.name = name;       // string (PascalCase)
    this.actions = actions; // ServiceAction[]
  }
}

export class ServiceAction {
  constructor(verb, model, clauses, modifiers) {
    this.kind = 'ServiceAction';
    this.verb = verb;         // string
    this.model = model;       // string
    this.clauses = clauses;   // ServiceClause[]
    this.modifiers = modifiers; // ServiceModifier[]
  }
}

export class ServiceTransitionRef {
  constructor(model, field) {
    this.kind = 'ServiceTransitionRef';
    this.model = model;
    this.field = field;
  }
}

export class ServiceClause {
  constructor(type, fields) {
    this.kind = 'ServiceClause';
    this.type = type;     // 'by' | 'where'
    this.fields = fields; // string[]
  }
}

export class ServiceModifier {
  constructor(type, value) {
    this.kind = 'ServiceModifier';
    this.type = type;   // 'auth' | 'public' | 'admin' | 'role' | 'limit' | 'page' | 'cache'
    this.value = value; // null | string | { amount, unit } | number
  }
}

// ---------------------------------------------------------------------------
// Rules Definitions
// ---------------------------------------------------------------------------

export class RulesDef {
  constructor(name, rules) {
    this.kind = 'RulesDef';
    this.name = name;
    this.rules = rules; // Rule[]
  }
}

export class DenyRule {
  constructor(verb, model) {
    this.kind = 'DenyRule';
    this.verb = verb;
    this.model = model;
  }
}

export class RequireRule {
  constructor(field, op, value, requirement) {
    this.kind = 'RequireRule';
    this.field = field;       // { model, field }
    this.op = op;
    this.value = value;
    this.requirement = requirement;
  }
}

export class LimitRule {
  constructor(field, value, limit, entity, timeUnit) {
    this.kind = 'LimitRule';
    this.field = field;
    this.value = value;
    this.limit = limit;
    this.entity = entity;
    this.timeUnit = timeUnit;
  }
}

// ---------------------------------------------------------------------------
// Guard Definitions
// ---------------------------------------------------------------------------

export class GuardDef {
  constructor(name, directives) {
    this.kind = 'GuardDef';
    this.name = name;
    this.directives = directives; // GuardDirective[]
  }
}

export class GuardDirective {
  constructor(type, config) {
    this.kind = 'GuardDirective';
    this.type = type;     // 'budget' | 'classify' | 'escalate' | 'sanitize' | 'timeout' | 'retry' | 'audit'
    this.config = config; // object (varies by type)
  }
}

// ---------------------------------------------------------------------------
// Pipeline Definitions
// ---------------------------------------------------------------------------

export class PipelineDef {
  constructor(name, trigger, steps, errorHandler) {
    this.kind = 'PipelineDef';
    this.name = name;
    this.trigger = trigger;
    this.steps = steps;           // string[]
    this.errorHandler = errorHandler; // ErrorStrategy | null
  }
}

export class PipelineTrigger {
  constructor(type, config) {
    this.kind = 'PipelineTrigger';
    this.type = type;     // 'transition' | 'event' | 'schedule' | 'action'
    this.config = config;
  }
}

export class ErrorStrategy {
  constructor(type, retries, fallback) {
    this.kind = 'ErrorStrategy';
    this.type = type;       // 'retry' | 'escalate' | 'fail' | 'skip' | 'rollback'
    this.retries = retries; // number | null
    this.fallback = fallback; // string | null
  }
}

// ---------------------------------------------------------------------------
// Task Definitions
// ---------------------------------------------------------------------------

export class TaskDef {
  constructor(name, priority, fields) {
    this.kind = 'TaskDef';
    this.name = name;
    this.priority = priority; // 'critical' | 'high' | 'normal' | 'low' | null
    this.fields = fields;     // Map<string, any>
  }
}

// ---------------------------------------------------------------------------
// Escape Block
// ---------------------------------------------------------------------------

export class EscapeBlock {
  constructor(content) {
    this.kind = 'EscapeBlock';
    this.content = content; // raw TypeScript string
  }
}
