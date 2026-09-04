const assert = require("assert");
const {
  ADMIN_DASHBOARD_HEADER,
  configuredAdminDashboardSecret,
  createAdminDashboardAuth
} = require("../src/middleware/adminDashboardAuth");

function invoke(environment, value) {
  return new Promise(resolve => {
    const req = { get: name => name === ADMIN_DASHBOARD_HEADER ? value : undefined };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ next: false, status: this.statusCode, body }); }
    };
    createAdminDashboardAuth({ environment })(req, res, () => resolve({ next: true, status: 200 }));
  });
}

async function main() {
  const secret = "dashboard-test-secret-0123456789-abcdef";
  assert.strictEqual(configuredAdminDashboardSecret({ ADMIN_DASHBOARD_SECRET: "short" }), "");
  assert.strictEqual(configuredAdminDashboardSecret({ ADMIN_DASHBOARD_SECRET: secret, JWT_SECRET: secret }), "");
  assert.strictEqual((await invoke({}, secret)).status, 404);
  assert.strictEqual((await invoke({ ADMIN_DASHBOARD_SECRET: secret }, "wrong-secret-value-that-is-long-enough")).status, 404);
  assert.strictEqual((await invoke({ ADMIN_DASHBOARD_SECRET: secret }, secret)).next, true);
  console.log("adminDashboardIndependentSecretTest=passed");
  console.log("adminDashboardFailClosedAuthTest=passed");
}

main().catch(err => { console.error(err); process.exitCode = 1; });
