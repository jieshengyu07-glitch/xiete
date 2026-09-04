const crypto = require("crypto");

const MIN_SECRET_LENGTH = 32;
const EXAMPLE_SECRETS = new Set([
  "change_me_to_a_long_random_monitoring_secret",
  "set_a_unique_random_monitoring_secret",
  "your_monitoring_hash_secret",
  "your_monitoring_hash_secret_here"
]);
const OTHER_SECRET_NAMES = [
  "JWT_SECRET",
  "CREDENTIAL_SECRET",
  "LEGACY_CREDENTIAL_SECRET",
  "SESSION_SECRET",
  "SESSION_ENCRYPTION_KEY",
  "ADMIN_DIAGNOSTIC_SECRET",
  "ADMIN_DASHBOARD_SECRET",
  "DATABASE_URL",
  "WECHAT_SECRET",
  "REVIEW_DEMO_PASSWORD"
];

function shanghaiDateString(value) {
  const date = value instanceof Date ? value : new Date(value === undefined ? Date.now() : value);
  if (Number.isNaN(date.getTime())) throw new TypeError("date is invalid");
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const part = type => parts.find(item => item.type === type).value;
  return part("year") + "-" + part("month") + "-" + part("day");
}

function createMonitoringIdentity(options) {
  const config = options || {};
  const environment = config.environment || process.env;
  const warn = config.warn || (message => console.warn(message));
  let warned = false;

  function warnDisabled() {
    if (warned) return;
    warned = true;
    try { warn("[monitoring] anonymous activity hashing disabled"); } catch (_) {}
  }

  function configuredSecret() {
    const secret = String(environment.MONITORING_HASH_SECRET || "").trim();
    const reused = OTHER_SECRET_NAMES.some(name => {
      const other = String(environment[name] || "").trim();
      return Boolean(other && other === secret);
    });
    if (!secret || secret.length < MIN_SECRET_LENGTH || EXAMPLE_SECRETS.has(secret.toLowerCase()) || reused) {
      warnDisabled();
      return "";
    }
    return secret;
  }

  function userDayHash(userIdentifier, occurredAt) {
    const identifier = String(userIdentifier || "");
    if (!identifier) return null;
    const secret = configuredSecret();
    if (!secret) return null;
    try {
      const day = shanghaiDateString(occurredAt);
      const dayKey = crypto.createHmac("sha256", secret).update(day, "utf8").digest();
      return crypto.createHmac("sha256", dayKey).update(identifier, "utf8").digest("hex");
    } catch (_) {
      warnDisabled();
      return null;
    }
  }

  return { configuredSecret, userDayHash };
}

const identity = createMonitoringIdentity();

module.exports = {
  createMonitoringIdentity,
  shanghaiDateString,
  userDayHash: identity.userDayHash
};
