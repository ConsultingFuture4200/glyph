// ===========================================================================
// Glyph Decompiler — AST → Glyph Source
// Phase D4: Bidirectional Mapping
//
// Converts AST nodes back to valid Glyph source code.
// This closes the homoiconic loop: agents can read task graph state
// as Glyph, modify it, and write it back. Zero NL translation layer.
//
// Two entry points:
//   1. decompile(ast)         — full AST → .glyph source
//   2. decompileWorkItems(items) — work_items JSON → task blocks
// ===========================================================================

// ---------------------------------------------------------------------------
// Main entry: AST → Glyph source
// ---------------------------------------------------------------------------

/**
 * Decompile a full AST back to Glyph source.
 * Produces valid, compilable .glyph output.
 *
 * @param {Program} ast
 * @returns {string} Glyph source code
 */
export function decompile(ast) {
  const blocks = [];
  for (const block of ast.blocks) {
    blocks.push(decompileBlock(block));
  }
  return blocks.join('\n\n') + '\n';
}

function decompileBlock(block) {
  switch (block.kind) {
    case 'TypeDef':        return decompileType(block);
    case 'ModelDef':       return decompileModel(block);
    case 'TransitionDef':  return decompileTransition(block);
    case 'ServiceDef':     return decompileService(block);
    case 'RulesDef':       return decompileRules(block);
    case 'GuardDef':       return decompileGuard(block);
    case 'PipelineDef':    return decompilePipeline(block);
    case 'TaskDef':        return decompileTask(block);
    case 'EscapeBlock':    return decompileEscape(block);
    default:
      throw new Error(`Unknown block kind: ${block.kind}`);
  }
}

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

function decompileType(node) {
  let line = `type ${node.name}: ${node.baseType}`;
  for (const c of node.constraints) {
    line += ' ' + decompileConstraint(c);
  }
  return line;
}

function decompileConstraint(c) {
  if (c.op === '..') return `${c.value[0]}..${c.value[1]}`;
  if (c.op === '~') return `~ ${c.value}`;
  return `${c.op} ${c.value}`;
}

// ---------------------------------------------------------------------------
// Model definitions
// ---------------------------------------------------------------------------

function decompileModel(node) {
  const lines = [];
  let header = `model ${node.name}`;
  if (node.classification.level || node.classification.ownedBy) {
    const parts = [];
    if (node.classification.level) parts.push(node.classification.level);
    if (node.classification.ownedBy) parts.push(`owned by ${node.classification.ownedBy}`);
    header += ` [${parts.join(', ')}]`;
  }
  lines.push(header);

  for (const field of node.fields) {
    lines.push('  ' + decompileField(field));
  }
  return lines.join('\n');
}

function decompileField(field) {
  let line = `${field.name}: `;

  // Type
  const type = field.type;
  if (type.variant === 'relation') {
    line += `-> ${type.value.target}`;
  } else if (type.variant === 'union') {
    const members = type.value.map(m => typeof m === 'string' ? m : m);
    line += members.join(' | ');
  } else if (type.variant === 'ref') {
    line += type.value;
  } else {
    line += type.value;
  }

  // Modifiers
  for (const mod of field.modifiers) {
    if (mod.modifier === 'key') line += ' key';
    else if (mod.modifier === 'unique') line += ' unique';
    else if (mod.modifier === 'optional') line += ' optional';
    else if (mod.modifier === 'index') line += ' index';
    else if (mod.modifier === 'default') line += ` = ${mod.value}`;
    else if (mod.modifier === 'constraint') {
      line += ' ' + decompileConstraint(mod.value);
    }
  }
  return line;
}

// ---------------------------------------------------------------------------
// Transition definitions
// ---------------------------------------------------------------------------

function decompileTransition(node) {
  const lines = [`transition ${node.model}.${node.field}`];
  for (const rule of node.rules) {
    const from = rule.from;
    const to = rule.to;
    const actions = rule.actions.map(a => decompileTransitionAction(a)).join(', ');
    lines.push(`  ${from} -> ${to}: ${actions}`);
  }
  return lines.join('\n');
}

function decompileTransitionAction(action) {
  switch (action.type) {
    case 'require': return `require ${action.value}`;
    case 'deny': return 'deny';
    case 'within': return `within ${action.value.amount} ${action.value.unit}`;
    case 'notify': return `notify ${action.value}`;
    case 'log': return 'log';
    case 'custom': return action.value;
    default: return action.value || action.type;
  }
}

// ---------------------------------------------------------------------------
// Service definitions
// ---------------------------------------------------------------------------

function decompileService(node) {
  const lines = [`service ${node.name}`];
  for (const action of node.actions) {
    if (action.kind === 'ServiceTransitionRef') {
      lines.push(`  transition ${action.model}.${action.field}`);
      continue;
    }
    let line = `  ${action.verb} ${action.model}`;
    for (const clause of action.clauses) {
      line += ` ${clause.type} ${clause.fields.join(', ')}`;
    }
    line += ': ';
    line += action.modifiers.map(m => decompileServiceModifier(m)).join(', ');
    lines.push(line);
  }
  return lines.join('\n');
}

function decompileServiceModifier(mod) {
  switch (mod.type) {
    case 'auth': return 'auth';
    case 'public': return 'public';
    case 'admin': return 'admin';
    case 'role': return `role ${mod.value}`;
    case 'limit': return `limit ${mod.value.amount}/${mod.value.unit}`;
    case 'page': return `page ${mod.value}`;
    case 'cache': return `cache ${mod.value.amount} ${mod.value.unit}`;
    default: return mod.type;
  }
}

// ---------------------------------------------------------------------------
// Rules definitions
// ---------------------------------------------------------------------------

function decompileRules(node) {
  const lines = [`rules ${node.name}`];
  for (const rule of node.rules) {
    switch (rule.kind) {
      case 'DenyRule':
        lines.push(`  deny ${rule.verb} ${rule.model}`);
        break;
      case 'RequireRule':
        lines.push(`  ${rule.field.model}.${rule.field.field} ${rule.op} ${rule.value} requires ${rule.requirement}`);
        break;
      case 'LimitRule':
        lines.push(`  ${rule.field.model}.${rule.field.field} = ${rule.value} limits ${rule.limit} ${rule.entity}/${rule.timeUnit}`);
        break;
      default:
        lines.push(`  # unknown rule kind: ${rule.kind}`);
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Guard definitions
// ---------------------------------------------------------------------------

function decompileGuard(node) {
  const lines = [`guard ${node.name}`];
  for (const d of node.directives) {
    switch (d.type) {
      case 'budget':
        lines.push(`  budget: ${d.config.amount}/${d.config.per}`);
        break;
      case 'classify':
        lines.push(`  classify: ${d.config.level}`);
        break;
      case 'escalate':
        lines.push(`  escalate above ${d.config.threshold} to ${d.config.target}`);
        break;
      case 'sanitize':
        lines.push(`  sanitize: ${d.config.fields.join(', ')}`);
        break;
      case 'timeout':
        lines.push(`  timeout: ${d.config.amount} ${d.config.unit}`);
        break;
      case 'retry': {
        let line = `  retry: ${d.config.count}`;
        if (d.config.fallback) line += ` then ${d.config.fallback}`;
        lines.push(line);
        break;
      }
      case 'audit':
        lines.push(`  audit: ${d.config.scope}`);
        break;
      default:
        lines.push(`  # unknown directive: ${d.type}`);
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Pipeline definitions
// ---------------------------------------------------------------------------

function decompilePipeline(node) {
  const lines = [`pipeline ${node.name}`];

  // Trigger
  const t = node.trigger;
  switch (t.type) {
    case 'transition':
      lines.push(`  when ${t.config.model}.${t.config.field} -> ${t.config.state}`);
      break;
    case 'event':
      lines.push(`  when ${t.config.event}`);
      break;
    case 'schedule':
      lines.push(`  every ${t.config.amount} ${t.config.unit}`);
      break;
    case 'action':
      lines.push(`  when ${t.config.verb} ${t.config.model}`);
      break;
  }

  // Steps
  lines.push('  ' + node.steps.join(' -> '));

  // Error handler
  if (node.errorHandler) {
    const eh = node.errorHandler;
    if (eh.type === 'retry') {
      let line = `  on failure: retry ${eh.retries}`;
      if (eh.fallback) line += ` then ${eh.fallback}`;
      lines.push(line);
    } else {
      lines.push(`  on failure: ${eh.type}`);
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Task definitions
// ---------------------------------------------------------------------------

function decompileTask(node) {
  const lines = [];
  let header = `task ${node.name}`;
  if (node.priority && node.priority !== 'normal') {
    header += ` [${node.priority}]`;
  }
  lines.push(header);

  // Emit fields in canonical order
  const fieldOrder = ['do', 'accept', 'context', 'route', 'parent', 'depends', 'budget'];
  for (const key of fieldOrder) {
    if (node.fields.has(key)) {
      lines.push(`  ${key}: ${node.fields.get(key)}`);
    }
  }
  // Any extra fields not in the canonical order
  for (const [key, value] of node.fields) {
    if (!fieldOrder.includes(key)) {
      lines.push(`  ${key}: ${value}`);
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Escape block
// ---------------------------------------------------------------------------

function decompileEscape(node) {
  return '```ts\n' + node.content + '\n```';
}


// ===========================================================================
// Work Items → Glyph Task Blocks
// ===========================================================================

/**
 * Convert work_items JSON records back to Glyph task blocks.
 * This is the "read" half of the bidirectional mapping:
 * agents can load task graph state as Glyph source.
 *
 * @param {object[]} workItems - Array of work_item records
 * @returns {string} Glyph source containing task blocks
 */
export function decompileWorkItems(workItems) {
  const blocks = [];

  for (const item of workItems) {
    const lines = [];
    let header = `task ${sanitizeName(item.name)}`;
    if (item.priority && item.priority !== 'normal') {
      header += ` [${item.priority}]`;
    }
    lines.push(header);

    if (item.description) {
      lines.push(`  do: ${item.description}`);
    }
    if (item.acceptance_criteria) {
      lines.push(`  accept: ${item.acceptance_criteria}`);
    }

    // Reconstruct context hints from context_profile_json
    if (item.context_profile_json?.domain_hints?.length > 0) {
      lines.push(`  context: ${item.context_profile_json.domain_hints.join(', ')}`);
    }

    if (item.routing_class) {
      lines.push(`  route: ${item.routing_class}`);
    }
    if (item.parent_id) {
      lines.push(`  parent: ${item.parent_id}`);
    }
    if (item.dependency_ids?.length > 0) {
      lines.push(`  depends: ${item.dependency_ids.join(', ')}`);
    }
    if (item.cost_budget != null) {
      lines.push(`  budget: ${item.cost_budget}`);
    }

    blocks.push(lines.join('\n'));
  }

  return blocks.join('\n\n') + '\n';
}

/**
 * Convert work_items JSON + a full AST into a complete .glyph file.
 * Useful for reconstructing the full source from a compiled state.
 *
 * @param {object[]} workItems - work_item records
 * @param {Program} ast - The program AST (types, models, services, etc.)
 * @returns {string} Complete .glyph source
 */
export function decompileFullState(workItems, ast) {
  // Decompile all non-task blocks from the AST
  const structuralBlocks = [];
  for (const block of ast.blocks) {
    if (block.kind !== 'TaskDef') {
      structuralBlocks.push(decompileBlock(block));
    }
  }

  // Decompile work items as task blocks
  const taskSource = decompileWorkItems(workItems);

  return structuralBlocks.join('\n\n') + '\n\n' + taskSource;
}


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sanitize a name for use as a Glyph identifier.
 * Converts spaces/dashes to PascalCase.
 */
function sanitizeName(name) {
  if (!name) return 'UnnamedTask';
  // Already PascalCase or camelCase — return as-is
  if (/^[A-Za-z][A-Za-z0-9]*$/.test(name)) return name;
  // Convert from snake_case, kebab-case, or space-separated
  return name
    .split(/[\s_-]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');
}
