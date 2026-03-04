// Glyph Runtime — Middleware
// Drop this in your output directory alongside generated files.
// Replace authenticate/authorize with your real auth logic.

export function authenticate(req, res, next) {
  // Stub: check for Authorization header
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  // TODO: Replace with your JWT/session validation
  // For now, just pass through with a stub user
  req.user = { id: 'stub-user-id', role: 'admin' };
  next();
}

export function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (roles.length > 0 && !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

export function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: result.error.flatten(),
      });
    }
    req.validatedBody = result.data;
    next();
  };
}
