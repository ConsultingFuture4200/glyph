// ===========================================================================
// Glyph Code Generator — Guard Configs (§5 Guardrails)
// Phase B: Compiler Core
//
// Generates JSON guardrail configs consumed by the Optimus orchestration
// layer. Co-located with code — a service cannot compile without a guard.
// ===========================================================================

export function generateGuardConfigs(ast) {
  const guards = ast.blocks.filter(b => b.kind === 'GuardDef');
  const configs = {};

  for (const guard of guards) {
    configs[guard.name] = generateGuardConfig(guard);
  }

  return JSON.stringify(configs, null, 2);
}

function generateGuardConfig(guard) {
  const config = {
    name: guard.name,
    version: '0.1.0',
    generated: true,
    directives: {},
  };

  for (const directive of guard.directives) {
    switch (directive.type) {
      case 'budget':
        config.directives.budget = {
          max_per_unit: directive.config.amount,
          unit: directive.config.per,
          currency: 'USD',
          action_on_exceed: 'deny',
        };
        break;

      case 'classify':
        config.directives.classification = {
          level: directive.config.level,
          encryption_at_rest: ['confidential', 'restricted'].includes(directive.config.level),
          audit_access: ['confidential', 'restricted'].includes(directive.config.level),
          gdpr_deletion_cascade: directive.config.level !== 'public',
        };
        break;

      case 'escalate':
        config.directives.escalation = {
          threshold: directive.config.threshold,
          target_tier: directive.config.target,
          auto_escalate: true,
        };
        break;

      case 'sanitize':
        config.directives.sanitization = {
          mode: directive.config.fields.includes('all') ? 'all' : 'selective',
          fields: directive.config.fields.includes('all') ? [] : directive.config.fields,
          pii_detection: true,
          log_sanitization: true,
        };
        break;

      case 'timeout':
        config.directives.timeout = {
          duration_seconds: durationToSeconds(directive.config),
          action_on_timeout: 'fail',
        };
        break;

      case 'retry':
        config.directives.retry = {
          max_retries: directive.config.count,
          fallback: directive.config.fallback || 'fail',
          backoff: 'exponential',
        };
        break;

      case 'audit':
        config.directives.audit = {
          scope: directive.config.scope,
          log_reads: directive.config.scope === 'all' || directive.config.scope === 'reads',
          log_mutations: directive.config.scope === 'all' || directive.config.scope === 'mutations',
          retention_days: 90,
        };
        break;
    }
  }

  return config;
}

function durationToSeconds(duration) {
  const multipliers = {
    'second': 1, 'seconds': 1,
    'minute': 60, 'minutes': 60,
    'hour': 3600, 'hours': 3600,
    'day': 86400, 'days': 86400,
  };
  return duration.amount * (multipliers[duration.unit] || 1);
}
