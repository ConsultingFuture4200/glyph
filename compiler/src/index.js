// ===========================================================================
// Glyph Compiler — Main Module
// Phase B: Compiler Core
//
// L5: Deterministic compilation. Same input → same output. Always.
// ===========================================================================

import { lex } from './lexer.js';
import { parse } from './parser.js';
import { applyConventions } from './conventions.js';
import { generateTypes } from './codegen_types.js';
import { generateSQL } from './codegen_sql.js';
import { generateRoutes } from './codegen_routes.js';
import { generateGuardConfigs } from './codegen_guards.js';
import { generateRulesMiddleware } from './codegen_rules.js';
import { generatePipelines } from './codegen_pipelines.js';
import { generateTaskGraph, generateAllContextProfiles } from './codegen_taskgraph.js';
import { decompile, decompileWorkItems } from './decompiler.js';
import { getAgentPrompt, getAllPrompts, estimatePromptTokens } from './agent_prompts.js';

export class CompileError extends Error {
  constructor(phase, inner) {
    super(`Compilation failed in ${phase}: ${inner.message}`);
    this.phase = phase;
    this.inner = inner;
  }
}

/**
 * Compile a Glyph source string into all output targets.
 *
 * @param {string} source - Glyph source code
 * @param {object} options - Compilation options
 * @returns {{ ast, types, sql, routes, guards, escapeBlocks, stats }}
 */
export function compile(source, options = {}) {
  const stats = { startTime: Date.now() };

  // Phase 1: Lex
  let tokens;
  try {
    tokens = lex(source);
    stats.tokenCount = tokens.length;
  } catch (err) {
    throw new CompileError('lexer', err);
  }

  // Phase 2: Parse
  let ast;
  try {
    ast = parse(tokens);
    stats.blockCount = ast.blocks.length;
  } catch (err) {
    throw new CompileError('parser', err);
  }

  // Phase 3: Apply conventions (L2 — defaults eliminate the common case)
  let conventionReport;
  try {
    const result = applyConventions(ast);
    ast = result.ast;
    conventionReport = result.conventions;
    stats.conventionsApplied = conventionReport.summary().total;
  } catch (err) {
    throw new CompileError('conventions', err);
  }

  // Phase 4: Validate (co-location enforcement)
  const services = ast.blocks.filter(b => b.kind === 'ServiceDef');
  const guards = ast.blocks.filter(b => b.kind === 'GuardDef');
  const guardNames = new Set(guards.map(g => g.name));

  if (!options.skipGuardCheck) {
    for (const service of services) {
      // Convention: guard name matches service name via multiple patterns
      // "Invoices" service matches: Invoices, InvoicesService, InvoiceService
      const singular = service.name.replace(/s$/, '');
      const expectedGuards = [
        service.name,                    // Invoices
        service.name + 'Service',        // InvoicesService
        singular + 'Service',            // InvoiceService
        singular,                        // Invoice
      ];
      const hasGuard = expectedGuards.some(n => guardNames.has(n));
      if (!hasGuard) {
        throw new CompileError('validation',
          new Error(`Service '${service.name}' has no guard block. A service cannot compile without its guard. Expected one of: ${[...new Set(expectedGuards)].join(', ')}`)
        );
      }
    }
  }

  // Phase 5: Code generation
  let types, sql, routes, guardConfigs;
  try {
    types = generateTypes(ast);
  } catch (err) {
    throw new CompileError('codegen:types', err);
  }
  try {
    sql = generateSQL(ast);
  } catch (err) {
    throw new CompileError('codegen:sql', err);
  }
  try {
    routes = generateRoutes(ast);
  } catch (err) {
    throw new CompileError('codegen:routes', err);
  }
  try {
    guardConfigs = generateGuardConfigs(ast);
  } catch (err) {
    throw new CompileError('codegen:guards', err);
  }

  let rulesMiddleware;
  try {
    rulesMiddleware = generateRulesMiddleware(ast);
  } catch (err) {
    throw new CompileError('codegen:rules', err);
  }

  let pipelines;
  try {
    pipelines = generatePipelines(ast);
  } catch (err) {
    throw new CompileError('codegen:pipelines', err);
  }

  // Phase D: Task graph integration
  let taskGraph, contextProfiles;
  try {
    taskGraph = generateTaskGraph(ast);
    stats.workItemCount = taskGraph.workItems.length;
  } catch (err) {
    throw new CompileError('codegen:taskgraph', err);
  }
  try {
    contextProfiles = generateAllContextProfiles(ast);
    stats.contextProfileCount = Object.keys(contextProfiles).length;
  } catch (err) {
    throw new CompileError('codegen:context_profiles', err);
  }

  // Collect escape blocks
  const escapeBlocks = ast.blocks
    .filter(b => b.kind === 'EscapeBlock')
    .map(b => b.content);

  stats.endTime = Date.now();
  stats.duration = stats.endTime - stats.startTime;
  stats.escapeBlockCount = escapeBlocks.length;
  stats.escapeHatchRatio = escapeBlocks.length / Math.max(ast.blocks.length, 1);

  return {
    ast,
    types,
    sql,
    routes,
    guards: guardConfigs,
    rulesMiddleware,
    pipelines,
    taskGraph,
    contextProfiles,
    escapeBlocks,
    conventions: conventionReport ? conventionReport.summary() : null,
    stats,
  };
}

export { lex, parse };
export { decompile, decompileWorkItems };
export { getAgentPrompt, getAllPrompts, estimatePromptTokens };
