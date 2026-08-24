const crypto = require("crypto");

class FixedWindowLimiter {
  constructor(options) {
    this.windowMs = Number(options.windowMs);
    this.max = Number(options.max);
    this.now = options.now || Date.now;
    this.entries = new Map();
    this.lastSweepAt = 0;
  }

  consume(key) {
    const now = this.now();
    if (now - this.lastSweepAt >= this.windowMs) this.sweep(now);
    const normalizedKey = String(key || "unknown");
    let entry = this.entries.get(normalizedKey);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + this.windowMs };
      this.entries.set(normalizedKey, entry);
    }
    entry.count += 1;
    return {
      allowed: entry.count <= this.max,
      remaining: Math.max(0, this.max - entry.count),
      retryAfter: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
      resetAt: entry.resetAt
    };
  }

  sweep(nowValue) {
    const now = Number(nowValue === undefined ? this.now() : nowValue);
    for (const [key, entry] of this.entries.entries()) {
      if (!entry || entry.resetAt <= now) this.entries.delete(key);
    }
    this.lastSweepAt = now;
  }
}

function hashIdentity(value) {
  return crypto.createHash("sha256").update(String(value || "unknown")).digest("hex").slice(0, 20);
}

function clientIp(req) {
  if (String(process.env.RENDER || "").toLowerCase() === "true") {
    const forwarded = String(req && req.headers && req.headers["x-forwarded-for"] || "");
    const first = forwarded.split(",")[0].trim();
    if (first) return first;
  }
  return String(req && req.socket && req.socket.remoteAddress || req && req.ip || "unknown");
}

function rateLimit(options) {
  const limiter = options.limiter || new FixedWindowLimiter(options);
  const keyType = options.keyType || "ip";
  const middleware = function(req, res, next) {
    const ip = clientIp(req);
    const userId = req && req.userId ? String(req.userId) : "anonymous";
    const rawKey = keyType === "user+ip" ? userId + "|" + ip : ip;
    const result = limiter.consume(hashIdentity(rawKey));
    res.setHeader("X-RateLimit-Limit", String(limiter.max));
    res.setHeader("X-RateLimit-Remaining", String(result.remaining));
    if (result.allowed) return next();
    res.setHeader("Retry-After", String(result.retryAfter));
    return res.status(429).json({
      success: false,
      error: "RATE_LIMITED",
      message: "操作太频繁，请稍后再试",
      retryAfter: result.retryAfter
    });
  };
  middleware.limiter = limiter;
  return middleware;
}

module.exports = {
  FixedWindowLimiter,
  clientIp,
  rateLimit
};
