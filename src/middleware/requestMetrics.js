const monitoringRepository = require("../repositories/monitoringRepository");

const FAILURE_LOG_INTERVAL_MS = 30000;
// Monitoring-only convention. This never changes the real HTTP response.
const CLIENT_CLOSED_REQUEST_STATUS = 499;
const FEATURE_CATEGORIES = new Set([
  "auth", "grades", "timetable", "preferences", "status", "account", "reviews", "system", "other"
]);
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

function requestFeatureCategory(methodValue, routeValue) {
  const method = String(methodValue || "").toUpperCase();
  const route = String(routeValue || "");
  const key = method + " " + route;
  let category = "other";
  if (key === "POST /auth/wechat-login") category = "auth";
  else if (["GET /grades", "GET /grade-changes", "POST /check", "POST /grades/import"].includes(key)) category = "grades";
  else if (["GET /timetable/config", "GET /timetable/today", "GET /timetable/week", "POST /timetable/sync"].includes(key)) category = "timetable";
  else if (key === "POST /preferences/campus") category = "preferences";
  else if (key === "GET /status") category = "status";
  else if (["POST /bind-account", "POST /unbind-account", "DELETE /account/data", "POST /account/delete-data"].includes(key)) category = "account";
  else if (["GET", "POST"].includes(method) && (route.includes("/reviews") || route.includes("course-reviews") || route.startsWith("/api/courses") || route.startsWith("/api/rank"))) category = "reviews";
  else if (method === "GET" && ["/api/school", "/api/announcement", "/api/home"].includes(route)) category = "system";
  if (!FEATURE_CATEGORIES.has(category) || !/^[A-Z]+$/.test(method)) return "other";
  return category;
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
      let recorded = false;
      const recordOnce = statusCode => {
        if (recorded) return;
        recorded = true;
        try {
          const elapsedNanoseconds = clock() - startedAt;
          const route = matchedRouteTemplate(req);
          const metric = {
            occurredAt: new Date(),
            method: String(req.method || "").toUpperCase(),
            route,
            statusCode: Number(statusCode),
            responseTimeMs: Math.max(0, Number(elapsedNanoseconds / 1000000n)),
            featureCategory: requestFeatureCategory(req.method, route)
          };
          Promise.resolve(insertRequestMetric(metric))
            .catch(() => safelyReportWriteFailure(onWriteFailure));
        } catch (_) {
          safelyReportWriteFailure(onWriteFailure);
        }
      };
      res.once("finish", () => recordOnce(res.statusCode));
      res.once("close", () => recordOnce(res.writableFinished ? res.statusCode : CLIENT_CLOSED_REQUEST_STATUS));
      req.once("aborted", () => recordOnce(CLIENT_CLOSED_REQUEST_STATUS));
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
module.exports.requestFeatureCategory = requestFeatureCategory;
module.exports.CLIENT_CLOSED_REQUEST_STATUS = CLIENT_CLOSED_REQUEST_STATUS;
