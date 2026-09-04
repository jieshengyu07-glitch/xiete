const crypto = require("crypto");

const ADMIN_DASHBOARD_HEADER = "X-Admin-Dashboard-Key";
const MIN_SECRET_LENGTH = 32;
const EXAMPLE_SECRETS = new Set([
  "change_me_to_a_long_random_secret",
  "change_me_to_a_long_random_admin_secret",
  "set_a_unique_random_admin_dashboard_secret",
  "set_a_unique_random_value_of_at_least_32_characters",
  "your_admin_dashboard_secret",
  "your_admin_dashboard_secret_here"
]);
const OTHER_SECRET_NAMES = [
  "JWT_SECRET",
  "CREDENTIAL_SECRET",
  "LEGACY_CREDENTIAL_SECRET",
  "SESSION_SECRET",
  "SESSION_ENCRYPTION_KEY",
  "ADMIN_DIAGNOSTIC_SECRET",
  "MONITORING_HASH_SECRET",
  "DATABASE_URL",
  "WECHAT_SECRET",
  "REVIEW_DEMO_PASSWORD"
];

function configuredAdminDashboardSecret(environment) {
  const env = environment || process.env;
  const secret = String(env.ADMIN_DASHBOARD_SECRET || "").trim();
  const reused = OTHER_SECRET_NAMES.some(name => {
    const other = String(env[name] || "").trim();
    return Boolean(other && other === secret);
  });
  if (!secret || secret.length < MIN_SECRET_LENGTH || EXAMPLE_SECRETS.has(secret.toLowerCase()) || reused) {
    return "";
  }
  return secret;
}

function constantTimeEqual(left, right) {
  const expected = Buffer.from(String(left || ""), "utf8");
  const provided = Buffer.from(String(right || ""), "utf8");
  if (expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(expected, provided);
}

function createAdminDashboardAuth(options) {
  const config = options || {};
  const environment = config.environment || process.env;
  return function adminDashboardAuth(req, res, next) {
    const secret = configuredAdminDashboardSecret(environment);
    const provided = req.get(ADMIN_DASHBOARD_HEADER);
    if (!secret || !provided || !constantTimeEqual(secret, provided)) {
      return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    }
    return next();
  };
}

const adminDashboardAuth = createAdminDashboardAuth();

module.exports = adminDashboardAuth;
module.exports.ADMIN_DASHBOARD_HEADER = ADMIN_DASHBOARD_HEADER;
module.exports.configuredAdminDashboardSecret = configuredAdminDashboardSecret;
module.exports.createAdminDashboardAuth = createAdminDashboardAuth;
