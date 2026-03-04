// ===========================================================================
// Glyph Code Generator — Task Graph Integration
// Phase D: Task Graph Integration (Deliverables 1–3)
//
// D1: Task block compilation to work_items row format
// D2: Context profile generation (populates context_profile_json)
// D3: Routing class inference from task structure (feeds §3)
//
// The homoiconic heart of Glyph: task descriptions are simultaneously
// data (stored in work_items) and executable instructions (consumed
// by agents). Zero transformation overhead, zero ambiguity.
// ===========================================================================

// ---------------------------------------------------------------------------
// D3: Routing Class Inference
// ---------------------------------------------------------------------------
// Instead of requiring explicit `route: executor` on every task, infer
// the routing class from the task's structural dependencies.
//
// Inference rules (ordered by priority):
//   1. Explicit `route:` field → use as-is (user always wins)
//   2. Task references budget thresholds or escalation → strategist
//   3. Task depends on multiple services or has architectural keywords → architect
//   4. Task is a review/audit/approval task → reviewer
//   5. Task references context summarization or utility work → utility
//   6. Default: single-service CRUD or implementation → executor
// ---------------------------------------------------------------------------

const STRATEGIST_SIGNALS = [
  // Budget/cost language
  'cost', 'budget', 'spending', 'pricing', 'revenue', 'roi',
  // Strategic language
  'strategy', 'roadmap', 'prioritize', 'tradeoff', 'trade-off',
  'architecture decision', 'evaluate', 'assess risk', 'plan',
  'milestone', 'quarterly', 'okr', 'kpi',
];

const ARCHITECT_SIGNALS = [
  // System design language
  'design', 'schema', 'migration', 'integrate', 'integration',
  'api design', 'data model', 'refactor', 'restructure',
  'system', 'infrastructure', 'scale', 'performance',
  'microservice', 'monolith', 'decompose', 'dependency',
];

const REVIEWER_SIGNALS = [
  'review', 'audit', 'approve', 'verify', 'validate',
  'check', 'inspect', 'compliance', 'security review',
  'code review', 'qa', 'test coverage', 'acceptance',
];

const UTILITY_SIGNALS = [
  'summarize', 'compress', 'compact', 'index', 'cache',
  'cleanup', 'archive', 'migrate data', 'backfill',
  'notification', 'alert', 'report', 'export',
];

/**
 * Infer routing class from task structure and the full AST context.
 *
 * @param {TaskDef} task - The task AST node
 * @param {Program} ast - Full program AST for cross-reference
 * @returns {{ routingClass: string, confidence: number, reason: string }}
 */
export function inferRoutingClass(task, ast) {
  // Rule 1: Explicit route always wins
  const explicitRoute = task.fields.get('route');
  if (explicitRoute) {
    return {
      routingClass: explicitRoute.trim(),
      confidence: 1.0,
      reason: 'explicit_route_field',
    };
  }

  const doText = (task.fields.get('do') || '').toLowerCase();
  const acceptText = (task.fields.get('accept') || '').toLowerCase();
  const contextText = (task.fields.get('context') || '').toLowerCase();
  const combinedText = `${doText} ${acceptText} ${contextText}`;

  const budgetVal = parseFloat(task.fields.get('budget') || '0');
  const dependsRaw = task.fields.get('depends') || '';
  const dependsList = dependsRaw ? dependsRaw.split(/[,\s]+/).filter(Boolean) : [];

  // Collect cross-references: which models/services does this task touch?
  const referencedModels = findModelReferences(combinedText, ast);
  const referencedServices = findServiceReferences(combinedText, ast);

  // Rule 2: Strategist signals
  // High budget, multiple service dependencies, or strategic language
  const strategistScore = scoreSignals(combinedText, STRATEGIST_SIGNALS);
  if (budgetVal >= 10.0 || strategistScore >= 2 || task.priority === 'critical') {
    return {
      routingClass: 'strategist',
      confidence: clampConfidence(0.6 + strategistScore * 0.1 + (budgetVal >= 10.0 ? 0.2 : 0)),
      reason: buildReason('strategist', { budgetVal, strategistScore, priority: task.priority }),
    };
  }

  // Rule 3: Architect signals
  // Multiple models/services referenced WITH architectural language,
  // or strong architectural signal alone. Simple CRUD across services
  // stays at executor level.
  const architectScore = scoreSignals(combinedText, ARCHITECT_SIGNALS);
  const isCrudTask = /\b(implement|crud|endpoint|create|build)\b/i.test(combinedText) && architectScore === 0;
  if (!isCrudTask && (
    (referencedServices.length >= 2 && architectScore >= 1) ||
    referencedServices.length >= 3 ||
    referencedModels.length >= 4 ||
    architectScore >= 2
  )) {
    return {
      routingClass: 'architect',
      confidence: clampConfidence(0.6 + architectScore * 0.1 + referencedServices.length * 0.05),
      reason: buildReason('architect', { referencedServices, referencedModels, architectScore }),
    };
  }

  // Rule 4: Reviewer signals
  const reviewerScore = scoreSignals(combinedText, REVIEWER_SIGNALS);
  if (reviewerScore >= 1) {
    return {
      routingClass: 'reviewer',
      confidence: clampConfidence(0.65 + reviewerScore * 0.1),
      reason: buildReason('reviewer', { reviewerScore }),
    };
  }

  // Rule 5: Utility signals
  const utilityScore = scoreSignals(combinedText, UTILITY_SIGNALS);
  if (utilityScore >= 1) {
    return {
      routingClass: 'utility',
      confidence: clampConfidence(0.65 + utilityScore * 0.1),
      reason: buildReason('utility', { utilityScore }),
    };
  }

  // Rule 6: Default — executor
  return {
    routingClass: 'executor',
    confidence: 0.7,
    reason: 'default_single_service_implementation',
  };
}

function scoreSignals(text, signals) {
  let score = 0;
  for (const signal of signals) {
    if (text.includes(signal)) score++;
  }
  return score;
}

function clampConfidence(v) {
  return Math.min(Math.max(v, 0.0), 1.0);
}

function findModelReferences(text, ast) {
  const models = ast.blocks.filter(b => b.kind === 'ModelDef').map(b => b.name);
  return models.filter(m => text.includes(m.toLowerCase()));
}

function findServiceReferences(text, ast) {
  const services = ast.blocks.filter(b => b.kind === 'ServiceDef').map(b => b.name);
  return services.filter(s => text.includes(s.toLowerCase()));
}

function buildReason(tier, signals) {
  const parts = [`inferred_${tier}`];
  if (signals.budgetVal && signals.budgetVal >= 10.0) parts.push(`budget=${signals.budgetVal}`);
  if (signals.priority) parts.push(`priority=${signals.priority}`);
  if (signals.referencedServices?.length) parts.push(`services=${signals.referencedServices.join(',')}`);
  if (signals.referencedModels?.length) parts.push(`models=${signals.referencedModels.join(',')}`);
  const scoreKey = Object.keys(signals).find(k => k.endsWith('Score'));
  if (scoreKey && signals[scoreKey]) parts.push(`signal_score=${signals[scoreKey]}`);
  return parts.join(';');
}


// ---------------------------------------------------------------------------
// D2: Context Profile Generation
// ---------------------------------------------------------------------------
// Generates a context_profile_json that tells the orchestrator exactly
// what context an agent needs loaded when working on a task.
//
// This is the primary mechanism for the token savings projection:
// instead of loading the full context window, agents get a minimal,
// pre-computed profile of what they need.
// ---------------------------------------------------------------------------

/**
 * Generate a context profile for a task.
 *
 * The profile specifies:
 *   - which models the agent needs to understand
 *   - which services are relevant
 *   - which transitions/rules/guards apply
 *   - what prior work (sibling tasks, parent tasks) to load
 *   - the token budget estimate for the context
 *
 * @param {TaskDef} task - The task AST node
 * @param {Program} ast - Full program AST
 * @returns {object} context_profile_json structure
 */
export function generateContextProfile(task, ast) {
  const doText = (task.fields.get('do') || '').toLowerCase();
  const acceptText = (task.fields.get('accept') || '').toLowerCase();
  const contextHints = (task.fields.get('context') || '')
    .split(/[,\s]+/)
    .map(s => s.trim())
    .filter(Boolean);
  const combinedText = `${doText} ${acceptText} ${contextHints.join(' ')}`;

  // Resolve model dependencies
  const allModels = ast.blocks.filter(b => b.kind === 'ModelDef');
  const allServices = ast.blocks.filter(b => b.kind === 'ServiceDef');
  const allTransitions = ast.blocks.filter(b => b.kind === 'TransitionDef');
  const allRules = ast.blocks.filter(b => b.kind === 'RulesDef');
  const allGuards = ast.blocks.filter(b => b.kind === 'GuardDef');
  const allPipelines = ast.blocks.filter(b => b.kind === 'PipelineDef');
  const allTypes = ast.blocks.filter(b => b.kind === 'TypeDef');

  // Find directly referenced models
  const referencedModels = allModels
    .filter(m => combinedText.includes(m.name.toLowerCase()))
    .map(m => m.name);

  // Expand: if a model is referenced, also include models it relates to
  const expandedModels = new Set(referencedModels);
  for (const modelName of referencedModels) {
    const model = allModels.find(m => m.name === modelName);
    if (model) {
      for (const field of model.fields) {
        if (field.type.variant === 'relation') {
          expandedModels.add(field.type.value.target);
        }
      }
    }
  }

  // Find referenced services
  const referencedServices = allServices
    .filter(s => combinedText.includes(s.name.toLowerCase()))
    .map(s => s.name);

  // If no explicit service references, infer from models
  if (referencedServices.length === 0) {
    for (const service of allServices) {
      const serviceModels = service.actions
        .filter(a => a.kind === 'ServiceAction')
        .map(a => a.model);
      if (serviceModels.some(m => expandedModels.has(m))) {
        referencedServices.push(service.name);
      }
    }
  }

  // Find applicable transitions
  const referencedTransitions = allTransitions
    .filter(t => expandedModels.has(t.model))
    .map(t => ({ model: t.model, field: t.field }));

  // Find applicable rules
  const referencedRules = allRules
    .filter(r => {
      // Check if any rule in this block references our models
      return r.rules.some(rule => {
        if (rule.kind === 'DenyRule') return expandedModels.has(rule.model);
        if (rule.kind === 'RequireRule') return expandedModels.has(rule.field?.model);
        if (rule.kind === 'LimitRule') return expandedModels.has(rule.field?.model);
        return false;
      });
    })
    .map(r => r.name);

  // Find applicable guards
  const referencedGuards = allGuards
    .filter(g => {
      const baseName = g.name.replace(/Service$/, '');
      return referencedServices.some(s =>
        s === g.name || s === baseName || s.replace(/s$/, '') === baseName
      );
    })
    .map(g => g.name);

  // Find applicable pipelines
  const referencedPipelines = allPipelines
    .filter(p => {
      if (p.trigger.type === 'transition') return expandedModels.has(p.trigger.config.model);
      if (p.trigger.type === 'action') return expandedModels.has(p.trigger.config.model);
      return false;
    })
    .map(p => p.name);

  // Find required custom types
  const referencedTypes = allTypes
    .filter(t => {
      return allModels
        .filter(m => expandedModels.has(m.name))
        .some(m => m.fields.some(f =>
          (f.type.variant === 'ref' && f.type.value === t.name) ||
          (f.type.variant === 'base' && f.type.value === t.name)
        ));
    })
    .map(t => t.name);

  // Resolve parent/depends for prior work loading
  const parentRef = task.fields.get('parent') || null;
  const dependsRaw = task.fields.get('depends') || '';
  const depends = dependsRaw ? dependsRaw.split(/[,\s]+/).filter(Boolean) : [];

  // Estimate token budget for this context profile
  const tokenEstimate = estimateContextTokens({
    models: expandedModels.size,
    services: referencedServices.length,
    transitions: referencedTransitions.length,
    rules: referencedRules.length,
    guards: referencedGuards.length,
    pipelines: referencedPipelines.length,
    types: referencedTypes.length,
    hasParent: !!parentRef,
    dependsCount: depends.length,
  });

  return {
    // Task identity
    task_name: task.name,
    priority: task.priority || 'normal',

    // Context blocks to load (ordered by importance)
    required_context: {
      // Core: the Glyph definitions the agent needs
      types: referencedTypes,
      models: [...expandedModels],
      services: referencedServices,
      transitions: referencedTransitions,
      rules: referencedRules,
      guards: referencedGuards,
      pipelines: referencedPipelines,
    },

    // Prior work references
    prior_work: {
      parent: parentRef,
      depends: depends,
      // Sibling tasks: loaded by orchestrator at runtime from task graph
      load_siblings: depends.length > 0 || !!parentRef,
    },

    // Context hints from the task definition
    domain_hints: contextHints,

    // Token budget for this context load
    token_budget: tokenEstimate,

    // Metadata for §8 pathway analytical views
    _meta: {
      generated_by: 'glyph_compiler',
      version: '0.1.0',
      model_count: expandedModels.size,
      service_count: referencedServices.length,
      total_blocks_referenced: expandedModels.size + referencedServices.length +
        referencedTransitions.length + referencedRules.length +
        referencedGuards.length + referencedPipelines.length,
    },
  };
}

/**
 * Estimate the token cost of loading a context profile.
 * Based on the Glyph token counts from Phase A analysis:
 *   - Model definition: ~25 tokens
 *   - Service definition: ~35 tokens
 *   - Transition block: ~12 tokens
 *   - Rules block: ~15 tokens
 *   - Guard block: ~20 tokens
 *   - Pipeline block: ~15 tokens
 *   - Type definition: ~8 tokens
 *   - Parent task summary: ~60 tokens
 *   - Sibling status per dep: ~20 tokens
 */
function estimateContextTokens(counts) {
  const base = {
    agent_identity: 80,       // Agent identity + guardrails (Glyph-compressed)
    task_description: 30,     // The task's own do/accept fields
  };

  const contextBlocks =
    counts.types * 8 +
    counts.models * 25 +
    counts.services * 35 +
    counts.transitions * 12 +
    counts.rules * 15 +
    counts.guards * 20 +
    counts.pipelines * 15 +
    (counts.hasParent ? 60 : 0) +
    counts.dependsCount * 20;

  return {
    estimated_tokens: base.agent_identity + base.task_description + contextBlocks,
    breakdown: {
      agent_identity: base.agent_identity,
      task_description: base.task_description,
      glyph_definitions: contextBlocks,
    },
    // Comparison for §8 tracking
    estimated_nl_equivalent: (base.agent_identity + base.task_description + contextBlocks) * 5,
    compression_ratio: 0.2, // ~80% reduction as projected
  };
}


// ---------------------------------------------------------------------------
// D1: Task Block Compilation to work_items Row Format
// ---------------------------------------------------------------------------
// Generates structured work_items rows that go directly into the task graph.
// Each row contains everything the orchestrator needs to route and execute.
// ---------------------------------------------------------------------------

/**
 * Compile all task blocks into work_items rows.
 *
 * @param {Program} ast - Full program AST
 * @returns {{ workItems: object[], sql: string, json: string }}
 */
export function generateTaskGraph(ast) {
  const tasks = ast.blocks.filter(b => b.kind === 'TaskDef');
  const workItems = [];

  for (const task of tasks) {
    const routing = inferRoutingClass(task, ast);
    const contextProfile = generateContextProfile(task, ast);
    const workItem = compileTaskToWorkItem(task, routing, contextProfile, ast);
    workItems.push(workItem);
  }

  // Generate SQL INSERT statements
  const sql = generateWorkItemsSQL(workItems);

  // Generate JSON for direct API consumption
  const json = JSON.stringify(workItems, null, 2);

  return { workItems, sql, json };
}

/**
 * Compile a single task into a work_items row.
 */
function compileTaskToWorkItem(task, routing, contextProfile, ast) {
  const budgetRaw = task.fields.get('budget');
  const parentRaw = task.fields.get('parent');
  const dependsRaw = task.fields.get('depends') || '';

  return {
    // Identity
    id: null, // Generated at insert time (uuid_generate_v4)
    name: task.name,

    // Task content
    description: task.fields.get('do') || '',
    acceptance_criteria: task.fields.get('accept') || '',

    // Priority from task definition (L2: defaults to 'normal')
    priority: task.priority || 'normal',

    // Routing (D3: inferred or explicit)
    routing_class: routing.routingClass,
    routing_confidence: routing.confidence,
    routing_reason: routing.reason,

    // Context profile (D2: pre-computed for token savings)
    context_profile_json: contextProfile,

    // Budget
    cost_budget: budgetRaw ? parseFloat(budgetRaw) : null,

    // Relationships
    parent_id: parentRaw || null,      // Resolved to UUID at runtime
    dependency_ids: dependsRaw         // Resolved to UUIDs at runtime
      ? dependsRaw.split(/[,\s]+/).filter(Boolean)
      : [],

    // Status (L2: default to 'pending')
    status: 'pending',

    // Source tracking for §8 pathway views
    _source: {
      language: 'glyph',
      compiler_version: '0.1.0',
      source_block: 'task',
      source_name: task.name,
    },
  };
}

/**
 * Generate SQL INSERT statements for work_items.
 */
function generateWorkItemsSQL(workItems) {
  const lines = [];
  lines.push(`-- Auto-generated by Glyph compiler v0.1.0 — Phase D Task Graph`);
  lines.push(`-- DO NOT EDIT — deterministic output from .glyph source\n`);

  // Ensure table exists
  lines.push(`CREATE TABLE IF NOT EXISTS work_items (`);
  lines.push(`  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),`);
  lines.push(`  name TEXT NOT NULL,`);
  lines.push(`  description TEXT NOT NULL,`);
  lines.push(`  acceptance_criteria TEXT,`);
  lines.push(`  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('critical', 'high', 'normal', 'low')),`);
  lines.push(`  routing_class TEXT NOT NULL CHECK (routing_class IN ('strategist', 'architect', 'executor', 'reviewer', 'utility')),`);
  lines.push(`  routing_confidence DOUBLE PRECISION,`);
  lines.push(`  routing_reason TEXT,`);
  lines.push(`  context_profile_json JSONB NOT NULL DEFAULT '{}',`);
  lines.push(`  cost_budget DOUBLE PRECISION,`);
  lines.push(`  parent_id UUID REFERENCES work_items(id),`);
  lines.push(`  dependency_ids UUID[] DEFAULT '{}',`);
  lines.push(`  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'blocked', 'complete', 'failed', 'cancelled')),`);
  lines.push(`  source_language TEXT DEFAULT 'glyph',`);
  lines.push(`  source_meta JSONB DEFAULT '{}',`);
  lines.push(`  created_at TIMESTAMPTZ DEFAULT NOW(),`);
  lines.push(`  updated_at TIMESTAMPTZ DEFAULT NOW()`);
  lines.push(`);\n`);

  // Indexes for common query patterns
  lines.push(`CREATE INDEX IF NOT EXISTS idx_work_items_status ON work_items(status);`);
  lines.push(`CREATE INDEX IF NOT EXISTS idx_work_items_routing ON work_items(routing_class);`);
  lines.push(`CREATE INDEX IF NOT EXISTS idx_work_items_priority ON work_items(priority);`);
  lines.push(`CREATE INDEX IF NOT EXISTS idx_work_items_parent ON work_items(parent_id);`);
  lines.push(`CREATE INDEX IF NOT EXISTS idx_work_items_context ON work_items USING gin(context_profile_json);\n`);

  // Insert rows
  for (const item of workItems) {
    const contextJson = JSON.stringify(item.context_profile_json).replace(/'/g, "''");
    const sourceJson = JSON.stringify(item._source).replace(/'/g, "''");
    const depsArray = item.dependency_ids.length > 0
      ? `ARRAY[${item.dependency_ids.map(d => `'${d}'`).join(',')}]::UUID[]`
      : `'{}'::UUID[]`;

    lines.push(`INSERT INTO work_items (name, description, acceptance_criteria, priority, routing_class, routing_confidence, routing_reason, context_profile_json, cost_budget, dependency_ids, source_language, source_meta)`);
    lines.push(`VALUES (`);
    lines.push(`  '${escapeSql(item.name)}',`);
    lines.push(`  '${escapeSql(item.description)}',`);
    lines.push(`  '${escapeSql(item.acceptance_criteria)}',`);
    lines.push(`  '${item.priority}',`);
    lines.push(`  '${item.routing_class}',`);
    lines.push(`  ${item.routing_confidence},`);
    lines.push(`  '${escapeSql(item.routing_reason)}',`);
    lines.push(`  '${contextJson}'::JSONB,`);
    lines.push(`  ${item.cost_budget !== null ? item.cost_budget : 'NULL'},`);
    lines.push(`  ${depsArray},`);
    lines.push(`  'glyph',`);
    lines.push(`  '${sourceJson}'::JSONB`);
    lines.push(`);\n`);
  }

  return lines.join('\n');
}

function escapeSql(str) {
  if (!str) return '';
  return str.replace(/'/g, "''");
}


// ---------------------------------------------------------------------------
// Context Profile Generation for Non-Task Blocks
// ---------------------------------------------------------------------------
// Services, models, and other blocks also need context profiles
// so agents know what to load when working on them.
// ---------------------------------------------------------------------------

/**
 * Generate context profiles for all blocks in the AST.
 * Returns a map of block_name → context_profile.
 */
export function generateAllContextProfiles(ast) {
  const profiles = {};

  for (const block of ast.blocks) {
    switch (block.kind) {
      case 'TaskDef':
        profiles[`task:${block.name}`] = generateContextProfile(block, ast);
        break;
      case 'ServiceDef':
        profiles[`service:${block.name}`] = generateServiceContextProfile(block, ast);
        break;
      case 'ModelDef':
        profiles[`model:${block.name}`] = generateModelContextProfile(block, ast);
        break;
    }
  }

  return profiles;
}

/**
 * Context profile for a service — what an agent needs to implement/modify it.
 */
function generateServiceContextProfile(service, ast) {
  const allModels = ast.blocks.filter(b => b.kind === 'ModelDef');
  const allTypes = ast.blocks.filter(b => b.kind === 'TypeDef');
  const allTransitions = ast.blocks.filter(b => b.kind === 'TransitionDef');
  const allGuards = ast.blocks.filter(b => b.kind === 'GuardDef');
  const allRules = ast.blocks.filter(b => b.kind === 'RulesDef');

  // Models referenced by service actions
  const serviceModels = new Set();
  for (const action of service.actions) {
    if (action.kind === 'ServiceAction') serviceModels.add(action.model);
    if (action.kind === 'ServiceTransitionRef') serviceModels.add(action.model);
  }

  // Expand to include related models
  for (const modelName of [...serviceModels]) {
    const model = allModels.find(m => m.name === modelName);
    if (model) {
      for (const field of model.fields) {
        if (field.type.variant === 'relation') serviceModels.add(field.type.value.target);
      }
    }
  }

  // Find types used by these models
  const usedTypes = allTypes.filter(t =>
    allModels.filter(m => serviceModels.has(m.name)).some(m =>
      m.fields.some(f => f.type.variant === 'ref' && f.type.value === t.name)
    )
  ).map(t => t.name);

  // Find transitions for these models
  const transitions = allTransitions
    .filter(t => serviceModels.has(t.model))
    .map(t => ({ model: t.model, field: t.field }));

  // Find matching guard
  const guards = allGuards.filter(g => {
    const baseName = g.name.replace(/Service$/, '');
    return service.name === g.name ||
      service.name === baseName ||
      service.name.replace(/s$/, '') === baseName;
  }).map(g => g.name);

  // Find matching rules
  const rules = allRules.filter(r =>
    r.rules.some(rule => {
      if (rule.kind === 'DenyRule') return serviceModels.has(rule.model);
      if (rule.kind === 'RequireRule') return serviceModels.has(rule.field?.model);
      if (rule.kind === 'LimitRule') return serviceModels.has(rule.field?.model);
      return false;
    })
  ).map(r => r.name);

  const tokenEst = estimateContextTokens({
    models: serviceModels.size,
    services: 1,
    transitions: transitions.length,
    rules: rules.length,
    guards: guards.length,
    pipelines: 0,
    types: usedTypes.length,
    hasParent: false,
    dependsCount: 0,
  });

  return {
    block_type: 'service',
    block_name: service.name,
    required_context: {
      types: usedTypes,
      models: [...serviceModels],
      services: [service.name],
      transitions,
      rules,
      guards,
      pipelines: [],
    },
    prior_work: { parent: null, depends: [], load_siblings: false },
    domain_hints: [],
    token_budget: tokenEst,
  };
}

/**
 * Context profile for a model — what an agent needs to understand/modify it.
 */
function generateModelContextProfile(model, ast) {
  const allModels = ast.blocks.filter(b => b.kind === 'ModelDef');
  const allTypes = ast.blocks.filter(b => b.kind === 'TypeDef');

  // Related models
  const relatedModels = new Set([model.name]);
  for (const field of model.fields) {
    if (field.type.variant === 'relation') relatedModels.add(field.type.value.target);
  }
  // Models that reference this model
  for (const m of allModels) {
    for (const f of m.fields) {
      if (f.type.variant === 'relation' && f.type.value.target === model.name) {
        relatedModels.add(m.name);
      }
    }
  }

  // Types used
  const usedTypes = allTypes.filter(t =>
    model.fields.some(f => f.type.variant === 'ref' && f.type.value === t.name)
  ).map(t => t.name);

  const tokenEst = estimateContextTokens({
    models: relatedModels.size,
    services: 0,
    transitions: 0,
    rules: 0,
    guards: 0,
    pipelines: 0,
    types: usedTypes.length,
    hasParent: false,
    dependsCount: 0,
  });

  return {
    block_type: 'model',
    block_name: model.name,
    required_context: {
      types: usedTypes,
      models: [...relatedModels],
      services: [],
      transitions: [],
      rules: [],
      guards: [],
      pipelines: [],
    },
    prior_work: { parent: null, depends: [], load_siblings: false },
    domain_hints: [],
    token_budget: tokenEst,
  };
}
