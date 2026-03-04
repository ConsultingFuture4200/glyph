// ===========================================================================
// Glyph Lexer — Indentation-aware tokenizer
// Phase B: Compiler Core
//
// Converts raw Glyph source into a token stream with explicit
// INDENT/DEDENT tokens. Fixed 2-space indentation per L1.
// ===========================================================================

export const TokenType = {
  // Structural
  INDENT: 'INDENT',
  DEDENT: 'DEDENT',
  NEWLINE: 'NEWLINE',
  EOF: 'EOF',

  // Declarators
  TYPE: 'type',
  MODEL: 'model',
  TRANSITION: 'transition',
  SERVICE: 'service',
  RULES: 'rules',
  GUARD: 'guard',
  PIPELINE: 'pipeline',
  TASK: 'task',

  // Base types
  INT: 'int', FLOAT: 'float', TEXT: 'text', BOOL: 'bool',
  UUID: 'uuid', TIMESTAMP: 'timestamp', DATE: 'date',
  TIME: 'time', JSON_TYPE: 'json', BYTES: 'bytes',

  // Modifiers
  KEY: 'key', UNIQUE: 'unique', OPTIONAL: 'optional', INDEX: 'index',

  // Classification
  PUBLIC: 'public', INTERNAL: 'internal',
  CONFIDENTIAL: 'confidential', RESTRICTED: 'restricted',
  OWNED: 'owned',

  // Service verbs
  CREATE: 'create', READ: 'read', UPDATE: 'update', DELETE: 'delete',
  LIST: 'list', SEARCH: 'search', ARCHIVE: 'archive', RESTORE: 'restore',
  EXPORT: 'export', IMPORT: 'import',

  // Actions / constraints
  REQUIRE: 'require', DENY: 'deny', WITHIN: 'within',
  NOTIFY: 'notify', LOG: 'log', REQUIRES: 'requires', LIMITS: 'limits',

  // Guard directives
  BUDGET: 'budget', CLASSIFY: 'classify', ESCALATE: 'escalate',
  SANITIZE: 'sanitize', TIMEOUT: 'timeout', RETRY: 'retry',
  AUDIT: 'audit', ABOVE: 'above',

  // Control
  WHEN: 'when', THEN: 'then', ON: 'on', EVERY: 'every',
  BY: 'by', WHERE: 'where', TO: 'to', FROM: 'from',

  // Pipeline / error
  FAILURE: 'failure', FAIL: 'fail', SKIP: 'skip', ROLLBACK: 'rollback',

  // Task
  DO: 'do', ACCEPT: 'accept', CONTEXT: 'context', ROUTE: 'route',
  PARENT: 'parent', DEPENDS: 'depends',

  // Routing classes
  STRATEGIST: 'strategist', ARCHITECT: 'architect',
  EXECUTOR: 'executor', REVIEWER: 'reviewer', UTILITY: 'utility',

  // Priority
  CRITICAL: 'critical', HIGH: 'high', NORMAL: 'normal', LOW: 'low',

  // Patterns
  EMAIL: 'email', URL: 'url', PHONE: 'phone', SLUG: 'slug', IP: 'ip',
  ISO_DATE: 'iso_date',

  // Operators / logic
  AND: 'and', OR: 'or', NOT: 'not', IS: 'is',

  // Literals
  TRUE: 'true', FALSE: 'false', NULL: 'null',
  NOW: 'now', AUTO: 'auto',

  // Time units
  SECOND: 'second', MINUTE: 'minute', HOUR: 'hour',
  DAY: 'day', WEEK: 'week', MONTH: 'month',
  SECONDS: 'seconds', MINUTES: 'minutes', HOURS: 'hours',
  DAYS: 'days', WEEKS: 'weeks', MONTHS: 'months',

  // Quantifiers / audit scope
  ALL: 'all', NONE: 'none', MUTATIONS: 'mutations', READS: 'reads',
  SET: 'set', UNSET: 'unset',

  // Auth
  AUTH: 'auth', ADMIN: 'admin', ROLE: 'role',
  LIMIT: 'limit', PAGE: 'page', CACHE: 'cache',

  // Symbols
  COLON: ':',
  ARROW: '->',
  PIPE: '|',
  EQUALS: '=',
  NOT_EQUALS: '!=',
  GTE: '>=',
  LTE: '<=',
  GT: '>',
  LT: '<',
  TILDE: '~',
  DOT_DOT: '..',
  COMMA: ',',
  DOT: '.',
  LBRACKET: '[',
  RBRACKET: ']',
  LPAREN: '(',
  RPAREN: ')',
  SLASH: '/',
  WILDCARD: '_',
  HASH: '#',

  // Escape hatch
  ESCAPE_OPEN: '```ts',
  ESCAPE_CLOSE: '```',

  // Values
  NUMBER: 'NUMBER',
  STRING: 'STRING',
  IDENTIFIER: 'IDENTIFIER',
  TYPE_NAME: 'TYPE_NAME',

  // Free text (for task descriptions)
  TEXT_CONTENT: 'TEXT_CONTENT',
};

// Build keyword lookup map
const KEYWORDS = new Map();
const keywordList = [
  'type', 'model', 'transition', 'service', 'rules', 'guard', 'pipeline', 'task',
  'int', 'float', 'text', 'bool', 'uuid', 'timestamp', 'date', 'time', 'json', 'bytes',
  'key', 'unique', 'optional', 'index',
  'public', 'internal', 'confidential', 'restricted', 'owned',
  'create', 'read', 'update', 'delete', 'list', 'search', 'archive', 'restore', 'export', 'import',
  'require', 'deny', 'within', 'notify', 'log', 'requires', 'limits',
  'budget', 'classify', 'escalate', 'sanitize', 'timeout', 'retry', 'audit', 'above',
  'when', 'then', 'on', 'every', 'by', 'where', 'to', 'from',
  'failure', 'fail', 'skip', 'rollback',
  'do', 'accept', 'context', 'route', 'parent', 'depends',
  'strategist', 'architect', 'executor', 'reviewer', 'utility',
  'critical', 'high', 'normal', 'low',
  'email', 'url', 'phone', 'slug', 'ip', 'iso_date',
  'and', 'or', 'not', 'is',
  'true', 'false', 'null', 'now', 'auto',
  'second', 'minute', 'hour', 'day', 'week', 'month',
  'seconds', 'minutes', 'hours', 'days', 'weeks', 'months',
  'all', 'none', 'mutations', 'reads', 'set', 'unset',
  'auth', 'admin', 'role', 'limit', 'page', 'cache',
];
for (const kw of keywordList) {
  KEYWORDS.set(kw, kw);
}

export class Token {
  constructor(type, value, line, col) {
    this.type = type;
    this.value = value;
    this.line = line;
    this.col = col;
  }
  toString() {
    return `Token(${this.type}, ${JSON.stringify(this.value)}, ${this.line}:${this.col})`;
  }
}

export class LexerError extends Error {
  constructor(message, line, col) {
    super(`Lexer error at ${line}:${col}: ${message}`);
    this.line = line;
    this.col = col;
  }
}

export function lex(source) {
  const tokens = [];
  const lines = source.split(/\r?\n/);
  const indentStack = [0]; // Stack of indentation levels
  let inEscapeBlock = false;
  let escapeContent = '';

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const rawLine = lines[lineIdx];
    const lineNum = lineIdx + 1;

    // Handle escape blocks
    if (inEscapeBlock) {
      if (rawLine.trimStart() === '```') {
        tokens.push(new Token(TokenType.TEXT_CONTENT, escapeContent.trimEnd(), lineNum, 1));
        tokens.push(new Token(TokenType.ESCAPE_CLOSE, '```', lineNum, 1));
        tokens.push(new Token(TokenType.NEWLINE, '\n', lineNum, rawLine.length + 1));
        inEscapeBlock = false;
        escapeContent = '';
      } else {
        escapeContent += rawLine + '\n';
      }
      continue;
    }

    // Check for escape block opening
    if (rawLine.trimStart() === '```ts') {
      // Process indentation change first (emit DEDENT if needed)
      const escIndent = rawLine.length - rawLine.trimStart().length;
      const currentIndent = indentStack[indentStack.length - 1];
      if (escIndent < currentIndent) {
        while (indentStack.length > 1 && indentStack[indentStack.length - 1] > escIndent) {
          indentStack.pop();
          tokens.push(new Token(TokenType.DEDENT, escIndent, lineNum, 1));
        }
      }
      tokens.push(new Token(TokenType.ESCAPE_OPEN, '```ts', lineNum, 1));
      tokens.push(new Token(TokenType.NEWLINE, '\n', lineNum, 6));
      inEscapeBlock = true;
      escapeContent = '';
      continue;
    }

    // Skip blank lines and comments
    const trimmed = rawLine.trimStart();
    if (trimmed === '' || trimmed.startsWith('#')) {
      // Still emit a newline for blank lines to separate blocks
      if (trimmed === '' && tokens.length > 0 && tokens[tokens.length - 1].type !== TokenType.NEWLINE) {
        tokens.push(new Token(TokenType.NEWLINE, '\n', lineNum, 1));
      }
      continue;
    }

    // Calculate indentation (fixed 2-space)
    const indent = rawLine.length - rawLine.trimStart().length;
    if (indent % 2 !== 0) {
      throw new LexerError(`Indentation must be a multiple of 2 spaces (found ${indent})`, lineNum, 1);
    }

    const currentIndent = indentStack[indentStack.length - 1];

    if (indent > currentIndent) {
      indentStack.push(indent);
      tokens.push(new Token(TokenType.INDENT, indent, lineNum, 1));
    } else if (indent < currentIndent) {
      while (indentStack.length > 1 && indentStack[indentStack.length - 1] > indent) {
        indentStack.pop();
        tokens.push(new Token(TokenType.DEDENT, indent, lineNum, 1));
      }
      if (indentStack[indentStack.length - 1] !== indent) {
        throw new LexerError(`Inconsistent dedent (expected ${indentStack[indentStack.length - 1]}, got ${indent})`, lineNum, 1);
      }
    }

    // Tokenize line content
    let pos = indent;
    while (pos < rawLine.length) {
      const ch = rawLine[pos];

      // Skip whitespace within line
      if (ch === ' ' || ch === '\t') {
        pos++;
        continue;
      }

      const col = pos + 1;

      // Two-character operators (check first)
      const twoChar = rawLine.slice(pos, pos + 2);
      if (twoChar === '->') { tokens.push(new Token(TokenType.ARROW, '->', lineNum, col)); pos += 2; continue; }
      if (twoChar === '..') { tokens.push(new Token(TokenType.DOT_DOT, '..', lineNum, col)); pos += 2; continue; }
      if (twoChar === '!=') { tokens.push(new Token(TokenType.NOT_EQUALS, '!=', lineNum, col)); pos += 2; continue; }
      if (twoChar === '>=') { tokens.push(new Token(TokenType.GTE, '>=', lineNum, col)); pos += 2; continue; }
      if (twoChar === '<=') { tokens.push(new Token(TokenType.LTE, '<=', lineNum, col)); pos += 2; continue; }

      // Single-character operators
      if (ch === ':') { tokens.push(new Token(TokenType.COLON, ':', lineNum, col)); pos++; continue; }
      if (ch === '|') { tokens.push(new Token(TokenType.PIPE, '|', lineNum, col)); pos++; continue; }
      if (ch === '=') { tokens.push(new Token(TokenType.EQUALS, '=', lineNum, col)); pos++; continue; }
      if (ch === '>') { tokens.push(new Token(TokenType.GT, '>', lineNum, col)); pos++; continue; }
      if (ch === '<') { tokens.push(new Token(TokenType.LT, '<', lineNum, col)); pos++; continue; }
      if (ch === '~') { tokens.push(new Token(TokenType.TILDE, '~', lineNum, col)); pos++; continue; }
      if (ch === ',') { tokens.push(new Token(TokenType.COMMA, ',', lineNum, col)); pos++; continue; }
      if (ch === '.') { tokens.push(new Token(TokenType.DOT, '.', lineNum, col)); pos++; continue; }
      if (ch === '[') { tokens.push(new Token(TokenType.LBRACKET, '[', lineNum, col)); pos++; continue; }
      if (ch === ']') { tokens.push(new Token(TokenType.RBRACKET, ']', lineNum, col)); pos++; continue; }
      if (ch === '(') { tokens.push(new Token(TokenType.LPAREN, '(', lineNum, col)); pos++; continue; }
      if (ch === ')') { tokens.push(new Token(TokenType.RPAREN, ')', lineNum, col)); pos++; continue; }
      if (ch === '/') { tokens.push(new Token(TokenType.SLASH, '/', lineNum, col)); pos++; continue; }

      // Numbers
      if (ch >= '0' && ch <= '9' || (ch === '-' && pos + 1 < rawLine.length && rawLine[pos + 1] >= '0' && rawLine[pos + 1] <= '9')) {
        let num = '';
        if (ch === '-') { num += '-'; pos++; }
        while (pos < rawLine.length && rawLine[pos] >= '0' && rawLine[pos] <= '9') {
          num += rawLine[pos]; pos++;
        }
        if (pos < rawLine.length && rawLine[pos] === '.' && pos + 1 < rawLine.length && rawLine[pos + 1] >= '0' && rawLine[pos + 1] <= '9') {
          num += '.'; pos++;
          while (pos < rawLine.length && rawLine[pos] >= '0' && rawLine[pos] <= '9') {
            num += rawLine[pos]; pos++;
          }
        }
        tokens.push(new Token(TokenType.NUMBER, num, lineNum, col));
        continue;
      }

      // Strings
      if (ch === '"' || ch === "'") {
        const quote = ch;
        let str = '';
        pos++; // skip opening quote
        while (pos < rawLine.length && rawLine[pos] !== quote) {
          str += rawLine[pos]; pos++;
        }
        if (pos >= rawLine.length) {
          throw new LexerError(`Unterminated string literal`, lineNum, col);
        }
        pos++; // skip closing quote
        tokens.push(new Token(TokenType.STRING, str, lineNum, col));
        continue;
      }

      // Underscore (wildcard) — only if standalone
      if (ch === '_' && (pos + 1 >= rawLine.length || !/[a-z0-9_]/.test(rawLine[pos + 1]))) {
        tokens.push(new Token(TokenType.WILDCARD, '_', lineNum, col));
        pos++;
        continue;
      }

      // Identifiers, keywords, type names
      if (/[a-zA-Z_]/.test(ch)) {
        let word = '';
        while (pos < rawLine.length && /[a-zA-Z0-9_]/.test(rawLine[pos])) {
          word += rawLine[pos]; pos++;
        }

        // Check if keyword
        const kw = KEYWORDS.get(word);
        if (kw) {
          tokens.push(new Token(kw, word, lineNum, col));
        } else if (word[0] >= 'A' && word[0] <= 'Z') {
          tokens.push(new Token(TokenType.TYPE_NAME, word, lineNum, col));
        } else {
          tokens.push(new Token(TokenType.IDENTIFIER, word, lineNum, col));
        }
        continue;
      }

      throw new LexerError(`Unexpected character: '${ch}'`, lineNum, col);
    }

    // End of line
    tokens.push(new Token(TokenType.NEWLINE, '\n', lineNum, rawLine.length + 1));
  }

  // Close remaining indentation
  while (indentStack.length > 1) {
    indentStack.pop();
    tokens.push(new Token(TokenType.DEDENT, 0, lines.length, 1));
  }

  tokens.push(new Token(TokenType.EOF, null, lines.length + 1, 1));
  return tokens;
}
