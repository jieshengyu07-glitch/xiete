const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const MIN_SECRET_LENGTH = 32;
const EXAMPLE_SECRETS = new Set([
  "campus_assistant_secret",
  "change_me_to_a_long_random_secret",
  "change_me_to_a_long_random_jwt_secret",
  "your_jwt_secret",
  "your_jwt_secret_here"
]);

let secret;

function assertJwtConfig() {
  if (secret) return;

  const configuredSecret = String(process.env.JWT_SECRET || "");
  const normalizedSecret = configuredSecret.trim();

  if (!normalizedSecret) {
    if (process.env.NODE_ENV === "development") {
      secret = crypto.randomBytes(48).toString("base64url");
      console.warn("[security] JWT_SECRET is not configured; using an ephemeral development-only key");
      return;
    }
    throw new Error("JWT_SECRET is required outside NODE_ENV=development");
  }

  if (normalizedSecret.length < MIN_SECRET_LENGTH) {
    throw new Error("JWT_SECRET must be at least " + MIN_SECRET_LENGTH + " characters long");
  }

  if (EXAMPLE_SECRETS.has(normalizedSecret.toLowerCase())) {
    throw new Error("JWT_SECRET must not use an example value");
  }

  secret = configuredSecret;
}

function signToken(payload) {
  assertJwtConfig();
  return jwt.sign(payload, secret, { expiresIn: "30d" });
}

function verifyToken(token) {
  assertJwtConfig();
  return jwt.verify(token, secret);
}

module.exports = {
  assertJwtConfig,
  signToken,
  verifyToken
};
