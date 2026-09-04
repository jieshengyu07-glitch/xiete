const monitoringRepository = require("../repositories/monitoringRepository");

const FAILURE_LOG_INTERVAL_MS = 30000;
let lastFailureLogAt = 0;

function shouldRecordRequest(req) {
  if (String(req && req.method || "").toUpperCase() === "OPTIONS") return false;
  const pathname = String(req && req.path || "");
  if (pathname === "/health") return false;
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return false;
  return true;
}

function matchedRouteTemplate(req) {
  const routePath = req && req.route && req.route.path;
  if (!req || !req.route) return "__unmatched__";
  if (typeof routePath !== "string" || !routePath || routePath.includes("?") || routePath.includes("#")) {
    return "__unknown__";
  }
  // This project registers routes directly on app. Avoid req.baseUrl because it
  // can contain matched user input when parameterized routers are introduced.
  return routePath;
}

function reportWriteFailure(now) {
  const timestamp = Number(now === undefined ? Date.now() : now);
  if (timestamp - lastFailureLogAt < FAILURE_LOG_INTERVAL_MS) return;
  lastFailureLogAt = timestamp;
  console.error("[monitoring] request metric write failed");
}

function safelyReportWriteFailure(onWriteFailure) {
  try { onWriteFailure(); } catch (_) {}
}

function createRequestMetrics(options) {
  const config = options || {};
  const insertRequestMetric = config.insertRequestMetric || monitoringRepository.insertRequestMetric;
  const clock = config.hrtime || process.hrtime.bigint;
  const onWriteFailure = config.onWriteFailure || reportWriteFailure;

  return function requestMetrics(req, res, next) {
    try {
      if (!shouldRecordRequest(req)) return next();
      const startedAt = clock();
      res.on("finish", () => {
        try {
          const elapsedNanoseconds = clock() - startedAt;
          const metric = {
            occurredAt: new Date(),
            method: String(req.method || "").toUpperCase(),
            route: matchedRouteTemplate(req),
            statusCode: Number(res.statusCode),
            responseTimeMs: Math.max(0, Number(elapsedNanoseconds / 1000000n))
          };
          Promise.resolve(insertRequestMetric(metric))
            .catch(() => safelyReportWriteFailure(onWriteFailure));
        } catch (_) {
          safelyReportWriteFailure(onWriteFailure);
        }
      });
    } catch (_) {
      safelyReportWriteFailure(onWriteFailure);
    }
    return next();
  };
}

module.exports = createRequestMetrics;
module.exports.createRequestMetrics = createRequestMetrics;
module.exports.matchedRouteTemplate = matchedRouteTemplate;
module.exports.shouldRecordRequest = shouldRecordRequest;
