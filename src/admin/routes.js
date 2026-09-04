const express = require("express");
const path = require("path");
const { rateLimit } = require("../middleware/rateLimit");
const {
  createAdminDashboardAuth,
  configuredAdminDashboardSecret
} = require("../middleware/adminDashboardAuth");
const { createAdminMetricsService } = require("../services/adminMetrics");

const ADMIN_DIR = __dirname;

function noStore(req, res, next) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  next();
}

function dashboardSecurity(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
  );
  next();
}

function safeApi(handler) {
  return async function adminApiHandler(req, res) {
    try {
      return res.json(await handler(req));
    } catch (err) {
      if (err && (err.code === "INVALID_TIMESERIES_WINDOW" || err.code === "INVALID_LIMIT")) {
        return res.status(400).json({ ok: false, error: err.code });
      }
      return res.status(503).json({ ok: false, error: "MONITORING_UNAVAILABLE" });
    }
  };
}

function createAdminRouter(options) {
  const config = options || {};
  const environment = config.environment || process.env;
  const service = config.service || createAdminMetricsService(config.serviceOptions);
  const router = express.Router();
  const limiter = config.limiter || rateLimit({ windowMs: 60 * 1000, max: 120, keyType: "ip" });
  const auth = createAdminDashboardAuth({ environment });
  const enabled = (req, res, next) => configuredAdminDashboardSecret(environment)
    ? next()
    : res.status(404).json({ ok: false, error: "NOT_FOUND" });

  router.use(noStore);
  router.get("/dashboard", limiter, enabled, dashboardSecurity, (req, res) => {
    res.sendFile(path.join(ADMIN_DIR, "dashboard.html"));
  });
  router.get("/dashboard.css", enabled, dashboardSecurity, (req, res) => {
    res.sendFile(path.join(ADMIN_DIR, "dashboard.css"));
  });
  router.get("/dashboard.js", enabled, dashboardSecurity, (req, res) => {
    res.sendFile(path.join(ADMIN_DIR, "dashboard.js"));
  });

  router.use("/metrics", limiter, auth);
  router.get("/metrics/summary", safeApi(() => service.summary()));
  router.get("/metrics/timeseries", safeApi(req => service.timeseries(req.query)));
  router.get("/metrics/errors", safeApi(req => service.errors(req.query)));
  router.get("/health", limiter, auth, safeApi(() => service.health()));
  return router;
}

module.exports = { createAdminRouter, noStore, dashboardSecurity };
