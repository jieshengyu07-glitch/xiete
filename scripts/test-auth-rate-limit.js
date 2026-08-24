const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { FixedWindowLimiter, rateLimit } = require("../src/middleware/rateLimit");

let now = 1000;
const limiter = new FixedWindowLimiter({ windowMs: 1000, max: 2, now: () => now });
assert.strictEqual(limiter.consume("same-key").allowed, true);
assert.strictEqual(limiter.consume("same-key").allowed, true);
assert.strictEqual(limiter.consume("same-key").allowed, false);
now = 2001;
assert.strictEqual(limiter.consume("same-key").allowed, true);
assert(limiter.entries.size <= 1);
console.log("rateLimitWindowBurstAndExpiryTest=passed");

const middleware = rateLimit({ windowMs: 60000, max: 1, keyType: "ip" });
const req = { socket: { remoteAddress: "127.0.0.1" }, headers: {} };
function response() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
}
let nextCount = 0;
middleware(req, response(), () => { nextCount += 1; });
const limitedResponse = response();
middleware(req, limitedResponse, () => { nextCount += 1; });
assert.strictEqual(nextCount, 1);
assert.strictEqual(limitedResponse.statusCode, 429);
assert.strictEqual(limitedResponse.body.error, "RATE_LIMITED");
assert(Number(limitedResponse.headers["Retry-After"]) >= 1);
console.log("rateLimit429ResponseTest=passed");

const serverSource = fs.readFileSync(path.join(__dirname, "..", "src", "server.js"), "utf8");
assert.match(serverSource, /wechatLoginLimiter[\s\S]*windowMs:\s*5\s*\*\s*60\s*\*\s*1000,\s*max:\s*10/);
assert.match(serverSource, /bindAccountLimiter[\s\S]*windowMs:\s*15\s*\*\s*60\s*\*\s*1000,\s*max:\s*8/);
assert.match(serverSource, /captchaSessionLimiter[\s\S]*windowMs:\s*5\s*\*\s*60\s*\*\s*1000,\s*max:\s*12/);
assert.match(serverSource, /captchaLoginLimiter[\s\S]*windowMs:\s*15\s*\*\s*60\s*\*\s*1000,\s*max:\s*10/);
assert.match(serverSource, /app\.post\("\/grades\/import",\s*requireLegacyAdminAccess,\s*auth/);
assert.match(serverSource, /app\.post\("\/upload-cookies",\s*requireLegacyAdminAccess,\s*auth/);
assert.match(serverSource, /app\.post\("\/upload-xg-session",\s*requireLegacyAdminAccess,\s*auth/);
console.log("authRouteLimiterAndLegacyAdminGateWiringTest=passed");
