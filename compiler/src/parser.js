// ===========================================================================
// Glyph Parser — Recursive Descent (PEG-style)
// Phase B: Compiler Core
//
// L5: Deterministic compilation — same input always produces same output.
// No AI in the parser, no heuristics, no ambiguity resolution.
// ===========================================================================

import { TokenType } from './lexer.js';
import * as AST from './ast.js';

export class ParseError extends Error {
  constructor(message, token) {
    const loc = token ? ` at ${token.line}:${token.col}` : '';
    super(`Parse error${loc}: ${message}`);
    this.token = token;
  }
}

export class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  // -------------------------------------------------------------------------
  // Token navigation
  // -------------------------------------------------------------------------

  peek() { return this.tokens[this.pos]; }
  advance() { return this.tokens[this.pos++]; }

  at(type) { return this.peek().type === type; }
  atAny(...types) { return types.includes(this.peek().type); }

  expect(type) {
    const tok = this.peek();
    if (tok.type !== type) {
      throw new ParseError(`Expected '${type}', got '${tok.type}' (${JSON.stringify(tok.value)})`, tok);
    }
    return this.advance();
  }

  match(type) {
    if (this.at(type)) { this.advance(); return true; }
    return false;
  }

  skipNewlines() {
    while (this.at(TokenType.NEWLINE)) this.advance();
  }

  // -------------------------------------------------------------------------
  // Program
  // -------------------------------------------------------------------------

  parse() {
    const blocks = [];
    this.skipNewlines();

    while (!this.at(TokenType.EOF)) {
      blocks.push(this.parseTopLevelBlock());
      this.skipNewlines();
    }

    return new AST.Program(blocks);
  }

  parseTopLevelBlock() {
    const tok = this.peek();
    switch (tok.type) {
      case 'type':       return this.parseTypeDef();
      case 'model':      return this.parseModelDef();
      case 'transition': return this.parseTransitionDef();
      case 'service':    return this.parseServiceDef();
      case 'rules':      return this.parseRulesDef();
      case 'guard':      return this.parseGuardDef();
      case 'pipeline':   return this.parsePipelineDef();
      case 'task':       return this.parseTaskDef();
      case TokenType.ESCAPE_OPEN: return this.parseEscapeBlock();
      default:
        throw new ParseError(`Expected top-level block (type, model, service, etc.), got '${tok.type}'`, tok);
    }
  }

  // -------------------------------------------------------------------------
  // Type Definitions
  // -------------------------------------------------------------------------

  parseTypeDef() {
    this.expect('type');
    const name = this.expect(TokenType.TYPE_NAME).value;
    this.expect(TokenType.COLON);
    const { baseType, constraints } = this.parseTypeExpr();
    this.expect(TokenType.NEWLINE);
    return new AST.TypeDef(name, baseType, constraints);
  }

  parseTypeExpr() {
    const baseType = this.parseBaseType();
    const constraints = [];
    while (this.atAny(TokenType.GTE, TokenType.LTE, TokenType.GT, TokenType.LT, TokenType.TILDE, TokenType.NUMBER)) {
      constraints.push(this.parseTypeConstraint());
    }
    return { baseType, constraints };
  }

  parseBaseType() {
    const tok = this.peek();
    const baseTypes = ['int', 'float', 'text', 'bool', 'uuid', 'timestamp', 'date', 'time', 'json', 'bytes'];
    if (baseTypes.includes(tok.type)) {
      this.advance();
      return tok.value;
    }
    if (tok.type === TokenType.TYPE_NAME) {
      this.advance();
      return tok.value;
    }
    throw new ParseError(`Expected type, got '${tok.type}'`, tok);
  }

  parseTypeConstraint() {
    const tok = this.peek();
    if (this.atAny(TokenType.GTE, TokenType.LTE, TokenType.GT, TokenType.LT)) {
      const op = this.advance().value;
      const val = this.parseNumber();
      return new AST.TypeConstraint(op, val);
    }
    if (this.at(TokenType.TILDE)) {
      this.advance();
      const pattern = this.advance().value; // pattern name or identifier
      return new AST.TypeConstraint('~', pattern);
    }
    if (this.at(TokenType.NUMBER)) {
      const min = this.parseNumber();
      this.expect(TokenType.DOT_DOT);
      const max = this.parseNumber();
      return new AST.TypeConstraint('..', [min, max]);
    }
    throw new ParseError(`Expected type constraint`, tok);
  }

  parseNumber() {
    const tok = this.expect(TokenType.NUMBER);
    return parseFloat(tok.value);
  }

  // -------------------------------------------------------------------------
  // Model Definitions
  // -------------------------------------------------------------------------

  parseModelDef() {
    this.expect('model');
    const name = this.expect(TokenType.TYPE_NAME).value;
    let classification = new AST.Classification(null, null);
    if (this.at(TokenType.LBRACKET)) {
      classification = this.parseClassification();
    }
    this.expect(TokenType.NEWLINE);
    this.expect(TokenType.INDENT);

    const fields = [];
    while (!this.at(TokenType.DEDENT) && !this.at(TokenType.EOF)) {
      fields.push(this.parseFieldDef());
      this.skipNewlines();
    }
    if (this.at(TokenType.DEDENT)) this.advance();

    return new AST.ModelDef(name, classification, fields);
  }

  parseClassification() {
    this.expect(TokenType.LBRACKET);
    let level = null;
    let ownedBy = null;

    while (!this.at(TokenType.RBRACKET)) {
      if (this.atAny('public', 'internal', 'confidential', 'restricted')) {
        level = this.advance().value;
      } else if (this.at('owned')) {
        this.advance(); // 'owned'
        this.expect('by');
        ownedBy = this.parseIdentifier();
      }
      this.match(TokenType.COMMA);
    }
    this.expect(TokenType.RBRACKET);
    return new AST.Classification(level, ownedBy);
  }

  parseFieldDef() {
    const name = this.parseIdentifier();
    this.expect(TokenType.COLON);
    const type = this.parseFieldType();
    const modifiers = [];

    // Parse modifiers until end of line
    while (!this.at(TokenType.NEWLINE) && !this.at(TokenType.DEDENT) && !this.at(TokenType.EOF)) {
      modifiers.push(this.parseFieldModifier());
    }
    if (this.at(TokenType.NEWLINE)) this.advance();

    return new AST.FieldDef(name, type, modifiers);
  }

  parseFieldType() {
    // Relation type: -> ModelName
    if (this.at(TokenType.ARROW)) {
      this.advance();
      const target = this.expect(TokenType.TYPE_NAME).value;
      return new AST.FieldType('relation', { target });
    }

    // Base type or type reference — then check for union
    const first = this.parseBaseTypeOrRef();

    // Check for union: first | second | ...
    if (this.at(TokenType.PIPE)) {
      const members = [first];
      while (this.match(TokenType.PIPE)) {
        members.push(this.parseUnionMember());
      }
      return new AST.FieldType('union', members);
    }

    return first;
  }

  parseBaseTypeOrRef() {
    const tok = this.peek();
    const baseTypes = ['int', 'float', 'text', 'bool', 'uuid', 'timestamp', 'date', 'time', 'json', 'bytes'];
    if (baseTypes.includes(tok.type)) {
      this.advance();
      return new AST.FieldType('base', tok.value);
    }
    if (tok.type === TokenType.TYPE_NAME) {
      this.advance();
      return new AST.FieldType('ref', tok.value);
    }
    // Identifiers can be union members
    if (tok.type === TokenType.IDENTIFIER) {
      this.advance();
      return tok.value; // raw string for union member
    }
    // Keywords used as first union member (admin, free, draft, etc.)
    // Check if next non-ws token is a pipe — if so, this keyword is a union member
    if (typeof tok.type === 'string' && tok.type === tok.value && /^[a-z_]/.test(tok.value)) {
      this.advance();
      return tok.value; // raw string for union member
    }
    throw new ParseError(`Expected type, got '${tok.type}'`, tok);
  }

  parseUnionMember() {
    const tok = this.peek();
    if (tok.type === TokenType.IDENTIFIER || tok.type === TokenType.STRING) {
      this.advance();
      return tok.value;
    }
    // Keywords used as enum values (free, pro, enterprise, draft, sent, paid, void, etc.)
    if (typeof tok.type === 'string' && tok.type === tok.value) {
      this.advance();
      return tok.value;
    }
    throw new ParseError(`Expected union member, got '${tok.type}'`, tok);
  }

  parseFieldModifier() {
    const tok = this.peek();
    if (tok.type === 'key') { this.advance(); return new AST.FieldModifier('key', null); }
    if (tok.type === 'unique') { this.advance(); return new AST.FieldModifier('unique', null); }
    if (tok.type === 'optional') { this.advance(); return new AST.FieldModifier('optional', null); }
    if (tok.type === 'index') { this.advance(); return new AST.FieldModifier('index', null); }
    if (tok.type === TokenType.EQUALS) {
      this.advance();
      const val = this.advance().value;
      return new AST.FieldModifier('default', val);
    }
    // Inline type constraints
    if (this.atAny(TokenType.GTE, TokenType.LTE, TokenType.GT, TokenType.LT, TokenType.TILDE, TokenType.NUMBER)) {
      const constraint = this.parseTypeConstraint();
      return new AST.FieldModifier('constraint', constraint);
    }
    throw new ParseError(`Expected field modifier, got '${tok.type}'`, tok);
  }

  // -------------------------------------------------------------------------
  // Transition Definitions
  // -------------------------------------------------------------------------

  parseTransitionDef() {
    this.expect('transition');
    const model = this.expect(TokenType.TYPE_NAME).value;
    this.expect(TokenType.DOT);
    const field = this.parseIdentifier();
    this.expect(TokenType.NEWLINE);
    this.expect(TokenType.INDENT);

    const rules = [];
    while (!this.at(TokenType.DEDENT) && !this.at(TokenType.EOF)) {
      rules.push(this.parseTransitionRule());
      this.skipNewlines();
    }
    if (this.at(TokenType.DEDENT)) this.advance();

    return new AST.TransitionDef(model, field, rules);
  }

  parseTransitionRule() {
    const from = this.parseStateRef();
    this.expect(TokenType.ARROW);
    const to = this.parseStateRef();
    this.expect(TokenType.COLON);
    const actions = [this.parseTransitionAction()];
    while (this.match(TokenType.COMMA)) {
      actions.push(this.parseTransitionAction());
    }
    if (this.at(TokenType.NEWLINE)) this.advance();
    return new AST.TransitionRule(from, to, actions);
  }

  parseStateRef() {
    if (this.at(TokenType.WILDCARD)) { this.advance(); return '_'; }
    return this.advance().value; // identifier or keyword-as-value
  }

  parseTransitionAction() {
    const tok = this.peek();
    if (tok.type === 'require') {
      this.advance();
      const val = this.advance().value;
      return new AST.TransitionAction('require', val);
    }
    if (tok.type === 'deny') {
      this.advance();
      return new AST.TransitionAction('deny', null);
    }
    if (tok.type === 'within') {
      this.advance();
      const duration = this.parseDuration();
      return new AST.TransitionAction('within', duration);
    }
    if (tok.type === 'notify') {
      this.advance();
      const target = this.advance().value;
      return new AST.TransitionAction('notify', target);
    }
    if (tok.type === 'log') {
      this.advance();
      return new AST.TransitionAction('log', null);
    }
    // Custom guard
    const val = this.advance().value;
    return new AST.TransitionAction('custom', val);
  }

  parseDuration() {
    const amount = this.parseNumber();
    const unit = this.advance().value;
    return new AST.Duration(amount, unit);
  }

  // -------------------------------------------------------------------------
  // Service Definitions
  // -------------------------------------------------------------------------

  parseServiceDef() {
    this.expect('service');
    const name = this.expect(TokenType.TYPE_NAME).value;
    this.expect(TokenType.NEWLINE);
    this.expect(TokenType.INDENT);

    const actions = [];
    while (!this.at(TokenType.DEDENT) && !this.at(TokenType.EOF)) {
      actions.push(this.parseServiceAction());
      this.skipNewlines();
    }
    if (this.at(TokenType.DEDENT)) this.advance();

    return new AST.ServiceDef(name, actions);
  }

  parseServiceAction() {
    // Check for transition reference
    if (this.at('transition')) {
      this.advance();
      const model = this.expect(TokenType.TYPE_NAME).value;
      this.expect(TokenType.DOT);
      const field = this.parseIdentifier();
      if (this.at(TokenType.NEWLINE)) this.advance();
      return new AST.ServiceTransitionRef(model, field);
    }

    const verb = this.advance().value; // service verb
    const model = this.expect(TokenType.TYPE_NAME).value;

    const clauses = [];
    while (this.atAny('by', 'where')) {
      clauses.push(this.parseServiceClause());
    }

    this.expect(TokenType.COLON);

    const modifiers = [this.parseServiceModifier()];
    while (this.match(TokenType.COMMA)) {
      modifiers.push(this.parseServiceModifier());
    }
    if (this.at(TokenType.NEWLINE)) this.advance();

    return new AST.ServiceAction(verb, model, clauses, modifiers);
  }

  parseServiceClause() {
    const type = this.advance().value; // 'by' or 'where'
    const fields = [this.parseIdentifier()];
    while (this.at(TokenType.COMMA) && this.tokens[this.pos + 1]?.type !== 'auth' &&
           this.tokens[this.pos + 1]?.type !== 'admin' && this.tokens[this.pos + 1]?.type !== 'public' &&
           this.tokens[this.pos + 1]?.type !== 'limit' && this.tokens[this.pos + 1]?.type !== 'page' &&
           this.tokens[this.pos + 1]?.type !== 'role' && this.tokens[this.pos + 1]?.type !== 'cache') {
      this.advance(); // comma
      fields.push(this.parseIdentifier());
    }
    return new AST.ServiceClause(type, fields);
  }

  parseServiceModifier() {
    const tok = this.peek();
    if (tok.type === 'auth') { this.advance(); return new AST.ServiceModifier('auth', null); }
    if (tok.type === 'public') { this.advance(); return new AST.ServiceModifier('public', null); }
    if (tok.type === 'admin') { this.advance(); return new AST.ServiceModifier('admin', null); }
    if (tok.type === 'role') {
      this.advance();
      const role = this.parseIdentifier();
      return new AST.ServiceModifier('role', role);
    }
    if (tok.type === 'limit') {
      this.advance();
      const amount = this.parseNumber();
      this.expect(TokenType.SLASH);
      const unit = this.advance().value;
      return new AST.ServiceModifier('limit', { amount, unit });
    }
    if (tok.type === 'page') {
      this.advance();
      const size = this.parseNumber();
      return new AST.ServiceModifier('page', size);
    }
    if (tok.type === 'cache') {
      this.advance();
      const duration = this.parseDuration();
      return new AST.ServiceModifier('cache', duration);
    }
    // role reference as identifier
    if (tok.type === 'admin') { this.advance(); return new AST.ServiceModifier('admin', null); }
    throw new ParseError(`Expected service modifier, got '${tok.type}'`, tok);
  }

  // -------------------------------------------------------------------------
  // Rules Definitions
  // -------------------------------------------------------------------------

  parseRulesDef() {
    this.expect('rules');
    const name = this.expect(TokenType.TYPE_NAME).value;
    this.expect(TokenType.NEWLINE);
    this.expect(TokenType.INDENT);

    const rules = [];
    while (!this.at(TokenType.DEDENT) && !this.at(TokenType.EOF)) {
      rules.push(this.parseRule());
      this.skipNewlines();
    }
    if (this.at(TokenType.DEDENT)) this.advance();

    return new AST.RulesDef(name, rules);
  }

  parseRule() {
    // deny verb Model
    if (this.at('deny')) {
      this.advance();
      const verb = this.advance().value;
      const model = this.expect(TokenType.TYPE_NAME).value;
      if (this.at(TokenType.NEWLINE)) this.advance();
      return new AST.DenyRule(verb, model);
    }

    // when Condition then Action
    if (this.at('when')) {
      this.advance();
      // Simple condition: Model.field op value
      const model = this.expect(TokenType.TYPE_NAME).value;
      this.expect(TokenType.DOT);
      const field = this.parseIdentifier();
      const op = this.advance().value; // comparison operator
      const value = this.advance().value;
      this.expect('then');
      this.expect('require');
      const requirement = this.advance().value;
      if (this.at(TokenType.NEWLINE)) this.advance();
      return new AST.RequireRule({ model, field }, op, value, requirement);
    }

    // Model.field op value requires/limits ...
    const model = this.expect(TokenType.TYPE_NAME).value;
    this.expect(TokenType.DOT);
    const field = this.parseIdentifier();
    const op = this.advance().value;

    // Could be a numeric literal or identifier
    const valueTok = this.advance();
    const value = valueTok.value;

    if (this.at('requires')) {
      this.advance();
      const requirement = this.advance().value;
      if (this.at(TokenType.NEWLINE)) this.advance();
      return new AST.RequireRule({ model, field }, op, value, requirement);
    }

    if (this.at('limits')) {
      this.advance();
      const limit = this.parseNumber();
      const entity = this.advance().value;
      this.expect(TokenType.SLASH);
      const timeUnit = this.advance().value;
      if (this.at(TokenType.NEWLINE)) this.advance();
      return new AST.LimitRule({ model, field }, value, limit, entity, timeUnit);
    }

    throw new ParseError(`Expected 'requires' or 'limits' in rule`, this.peek());
  }

  // -------------------------------------------------------------------------
  // Guard Definitions
  // -------------------------------------------------------------------------

  parseGuardDef() {
    this.expect('guard');
    const name = this.expect(TokenType.TYPE_NAME).value;
    this.expect(TokenType.NEWLINE);
    this.expect(TokenType.INDENT);

    const directives = [];
    while (!this.at(TokenType.DEDENT) && !this.at(TokenType.EOF)) {
      directives.push(this.parseGuardDirective());
      this.skipNewlines();
    }
    if (this.at(TokenType.DEDENT)) this.advance();

    return new AST.GuardDef(name, directives);
  }

  parseGuardDirective() {
    const tok = this.peek();

    if (tok.type === 'budget') {
      this.advance(); this.expect(TokenType.COLON);
      const amount = this.parseNumber();
      this.expect(TokenType.SLASH);
      const per = this.advance().value;
      if (this.at(TokenType.NEWLINE)) this.advance();
      return new AST.GuardDirective('budget', { amount, per });
    }
    if (tok.type === 'classify') {
      this.advance(); this.expect(TokenType.COLON);
      const level = this.advance().value;
      if (this.at(TokenType.NEWLINE)) this.advance();
      return new AST.GuardDirective('classify', { level });
    }
    if (tok.type === 'escalate') {
      this.advance();
      this.expect('above');
      const threshold = this.parseNumber();
      this.expect('to');
      const target = this.advance().value;
      if (this.at(TokenType.NEWLINE)) this.advance();
      return new AST.GuardDirective('escalate', { threshold, target });
    }
    if (tok.type === 'sanitize') {
      this.advance(); this.expect(TokenType.COLON);
      const fields = [];
      if (this.at('all')) { this.advance(); fields.push('all'); }
      else {
        fields.push(this.parseIdentifier());
        while (this.match(TokenType.COMMA)) fields.push(this.parseIdentifier());
      }
      if (this.at(TokenType.NEWLINE)) this.advance();
      return new AST.GuardDirective('sanitize', { fields });
    }
    if (tok.type === 'timeout') {
      this.advance(); this.expect(TokenType.COLON);
      const duration = this.parseDuration();
      if (this.at(TokenType.NEWLINE)) this.advance();
      return new AST.GuardDirective('timeout', duration);
    }
    if (tok.type === 'retry') {
      this.advance(); this.expect(TokenType.COLON);
      const count = this.parseNumber();
      let fallback = null;
      if (this.match('then')) { fallback = this.advance().value; }
      if (this.at(TokenType.NEWLINE)) this.advance();
      return new AST.GuardDirective('retry', { count, fallback });
    }
    if (tok.type === 'audit') {
      this.advance(); this.expect(TokenType.COLON);
      const scope = this.advance().value;
      if (this.at(TokenType.NEWLINE)) this.advance();
      return new AST.GuardDirective('audit', { scope });
    }

    throw new ParseError(`Expected guard directive, got '${tok.type}'`, tok);
  }

  // -------------------------------------------------------------------------
  // Pipeline Definitions
  // -------------------------------------------------------------------------

  parsePipelineDef() {
    this.expect('pipeline');
    const name = this.expect(TokenType.TYPE_NAME).value;
    this.expect(TokenType.NEWLINE);
    this.expect(TokenType.INDENT);

    const trigger = this.parsePipelineTrigger();
    this.skipNewlines();
    const steps = this.parsePipelineSteps();
    this.skipNewlines();

    let errorHandler = null;
    if (this.at('on')) {
      errorHandler = this.parsePipelineErrorHandler();
      this.skipNewlines();
    }

    if (this.at(TokenType.DEDENT)) this.advance();
    return new AST.PipelineDef(name, trigger, steps, errorHandler);
  }

  parsePipelineTrigger() {
    if (this.at('when')) {
      this.advance();
      // when Model.field -> state
      if (this.at(TokenType.TYPE_NAME)) {
        const saved = this.pos;
        const model = this.advance().value;
        if (this.at(TokenType.DOT)) {
          this.advance();
          const field = this.parseIdentifier();
          this.expect(TokenType.ARROW);
          const state = this.advance().value;
          if (this.at(TokenType.NEWLINE)) this.advance();
          return new AST.PipelineTrigger('transition', { model, field, state });
        }
        // Backtrack — not Model.field, might be something else
        this.pos = saved;
      }
      // when verb Model (e.g., when create User)
      const serviceVerbs = ['create','read','update','delete','list','search','archive','restore','export','import'];
      if (serviceVerbs.includes(this.peek().type)) {
        const verb = this.advance().value;
        const model = this.expect(TokenType.TYPE_NAME).value;
        if (this.at(TokenType.NEWLINE)) this.advance();
        return new AST.PipelineTrigger('action', { verb, model });
      }
      // when event_name
      const event = this.advance().value;
      if (this.at(TokenType.NEWLINE)) this.advance();
      return new AST.PipelineTrigger('event', { event });
    }
    if (this.at('every')) {
      this.advance();
      const duration = this.parseDuration();
      if (this.at(TokenType.NEWLINE)) this.advance();
      return new AST.PipelineTrigger('schedule', duration);
    }
    if (this.at('on')) {
      this.advance();
      const verb = this.advance().value;
      const model = this.expect(TokenType.TYPE_NAME).value;
      if (this.at(TokenType.NEWLINE)) this.advance();
      return new AST.PipelineTrigger('action', { verb, model });
    }
    throw new ParseError(`Expected pipeline trigger`, this.peek());
  }

  parsePipelineSteps() {
    const steps = [this.parsePipelineStepName()];
    while (this.at(TokenType.ARROW)) {
      this.advance();
      steps.push(this.parsePipelineStepName());
    }
    if (this.at(TokenType.NEWLINE)) this.advance();
    return steps;
  }

  parsePipelineStepName() {
    let name = this.advance().value;
    // Multi-word step names: "notify customer", "credit balance"
    while (!this.at(TokenType.ARROW) && !this.at(TokenType.NEWLINE) &&
           !this.at(TokenType.DEDENT) && !this.at(TokenType.EOF) &&
           !this.at('on')) {
      name += '_' + this.advance().value;
    }
    return name;
  }

  parsePipelineErrorHandler() {
    this.expect('on');
    this.expect('failure');
    this.expect(TokenType.COLON);

    const tok = this.peek();
    if (tok.type === 'retry') {
      this.advance();
      const count = this.parseNumber();
      let fallback = null;
      if (this.match('then')) { fallback = this.advance().value; }
      if (this.at(TokenType.NEWLINE)) this.advance();
      return new AST.ErrorStrategy('retry', count, fallback);
    }
    const strategy = this.advance().value;
    if (this.at(TokenType.NEWLINE)) this.advance();
    return new AST.ErrorStrategy(strategy, null, null);
  }

  // -------------------------------------------------------------------------
  // Task Definitions
  // -------------------------------------------------------------------------

  parseTaskDef() {
    this.expect('task');
    const name = this.at(TokenType.TYPE_NAME) ? this.advance().value : this.parseIdentifier();
    let priority = null;
    if (this.at(TokenType.LBRACKET)) {
      this.advance();
      priority = this.advance().value;
      this.expect(TokenType.RBRACKET);
    }
    this.expect(TokenType.NEWLINE);
    this.expect(TokenType.INDENT);

    const fields = new Map();
    while (!this.at(TokenType.DEDENT) && !this.at(TokenType.EOF)) {
      const fieldTok = this.peek();
      const fieldName = this.advance().value; // do, accept, context, route, parent, depends, budget
      this.expect(TokenType.COLON);

      // Read rest of line as text content
      let value = '';
      while (!this.at(TokenType.NEWLINE) && !this.at(TokenType.DEDENT) && !this.at(TokenType.EOF)) {
        const t = this.advance();
        value += (value ? ' ' : '') + t.value;
      }
      fields.set(fieldName, value);
      this.skipNewlines();
    }
    if (this.at(TokenType.DEDENT)) this.advance();

    return new AST.TaskDef(name, priority, fields);
  }

  // -------------------------------------------------------------------------
  // Escape Block
  // -------------------------------------------------------------------------

  parseEscapeBlock() {
    this.expect(TokenType.ESCAPE_OPEN);
    this.skipNewlines();
    let content = '';
    if (this.at(TokenType.TEXT_CONTENT)) {
      content = this.advance().value;
    }
    if (this.at(TokenType.ESCAPE_CLOSE)) this.advance();
    this.skipNewlines();
    return new AST.EscapeBlock(content);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  parseIdentifier() {
    const tok = this.peek();
    // Many keywords can also be used as identifiers (field names, etc.)
    if (tok.type === TokenType.IDENTIFIER) {
      return this.advance().value;
    }
    // Allow keywords as identifiers in field position
    if (typeof tok.type === 'string' && tok.value && /^[a-z_][a-z0-9_]*$/.test(tok.value)) {
      return this.advance().value;
    }
    throw new ParseError(`Expected identifier, got '${tok.type}'`, tok);
  }
}

export function parse(tokens) {
  const parser = new Parser(tokens);
  return parser.parse();
}
