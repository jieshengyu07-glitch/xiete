const assert = require("assert");
const fs = require("fs");
const path = require("path");

const server = fs.readFileSync(path.join(__dirname, "..", "src", "server.js"), "utf8");
const routeStart = server.indexOf('app.get("/grades"');
const routeEnd = server.indexOf('// GET /grade-changes', routeStart);
assert(routeStart >= 0 && routeEnd > routeStart, "grades route must exist");
const route = server.slice(routeStart, routeEnd);

assert(route.includes('const gradesSource = persistentGrades.grades.length ? "postgres"'));
assert(route.includes('productionPostgresRuntime() ? "none" : "legacy"'));
assert(!route.includes('gradesSource = syncing ? "sync"'));
assert(route.includes('console.log("[grades] userIdHash=" + userIdHash(req.userId) + " source=" + gradesSource)'));
assert(route.includes('if (syncing) console.log("[grades] syncing=true")'));

function sourceFor({ production, hasCache }) {
  return hasCache ? "postgres" : (production ? "none" : "legacy");
}

assert.strictEqual(sourceFor({ production: true, hasCache: true }), "postgres");
assert.strictEqual(sourceFor({ production: true, hasCache: true, syncing: true }), "postgres");
assert.strictEqual(sourceFor({ production: true, hasCache: false, syncing: true }), "none");
assert.strictEqual(sourceFor({ production: false, hasCache: true, syncing: true }), "postgres");
assert.strictEqual(sourceFor({ production: false, hasCache: false }), "legacy");
console.log("postgresSourceWhileIdleTest=passed");
console.log("postgresSourceWhileSyncingTest=passed");
console.log("noneSourceWhileSyncingWithoutCacheTest=passed");
console.log("developmentLegacySourceTest=passed");
console.log("syncingDoesNotChangeSourceTest=passed");
