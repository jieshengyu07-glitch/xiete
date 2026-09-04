const monitoringRepository = require("../repositories/monitoringRepository");
const monitoringIdentity = require("./monitoringIdentity");

const FAILURE_LOG_INTERVAL_MS = 30000;
let lastFailureLogAt = 0;

function reportWriteFailure(now) {
  const timestamp = Number(now === undefined ? Date.now() : now);
  if (timestamp - lastFailureLogAt < FAILURE_LOG_INTERVAL_MS) return;
  lastFailureLogAt = timestamp;
  console.error("[monitoring] business event write failed");
}

function safelyReportWriteFailure(callback) {
  try { callback(); } catch (_) {}
}

function statusErrorType(statusCode) {
  const status = Number(statusCode);
  if (status === 401 || status === 403) return "UNAUTHORIZED";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "INTERNAL_ERROR";
  return "UNKNOWN";
}

function createBusinessEventRecorder(options) {
  const config = options || {};
  const repository = config.repository || monitoringRepository;
  const identity = config.identity || monitoringIdentity;
  const clock = config.hrtime || process.hrtime.bigint;
  const onWriteFailure = config.onWriteFailure || reportWriteFailure;

  function recordMonitorEvent(value) {
    const input = value && typeof value === "object" ? value : {};
    let userDayHash = null;
    try {
      userDayHash = identity.userDayHash(input.userIdentifier, input.occurredAt);
    } catch (_) {
      userDayHash = null;
    }

    const event = {
      occurredAt: input.occurredAt,
      eventType: input.eventType,
      success: input.success,
      errorType: input.success ? null : monitoringRepository.normalizeMonitorErrorType(input.errorType),
      durationMs: input.durationMs,
      userDayHash,
      source: monitoringRepository.normalizeMonitorSource(input.source)
    };
    try {
      Promise.resolve(repository.insertMonitorEvent(event))
        .catch(() => safelyReportWriteFailure(onWriteFailure));
    } catch (_) {
      safelyReportWriteFailure(onWriteFailure);
    }
  }

  function monitorBusinessEvent(eventType, eventOptions) {
    const settings = eventOptions || {};
    return function businessEventMiddleware(req, res, next) {
      try {
        const startedAt = clock();
        let explicitSuccess = null;
        let errorType = null;
        const originalJson = res.json;
        res.json = function monitoredJson(body) {
          try {
            if (body && typeof body === "object") {
              if (typeof body.success === "boolean") explicitSuccess = body.success;
              else if (body.code === 0) explicitSuccess = true;
              const candidateErrorType = body.error || body.errorCode;
              if (candidateErrorType) {
                errorType = monitoringRepository.normalizeMonitorErrorType(candidateErrorType);
              }
            }
          } catch (_) {}
          return originalJson.call(this, body);
        };
        res.on("finish", () => {
          try {
            const elapsed = clock() - startedAt;
            const success = explicitSuccess === null
              ? Number(res.statusCode) < 400
              : Boolean(explicitSuccess && Number(res.statusCode) < 400);
            const occurredAt = new Date();
            recordMonitorEvent({
              occurredAt,
              eventType,
              success,
              errorType: success ? null : (errorType || statusErrorType(res.statusCode)),
              durationMs: Math.max(0, Number(elapsed / 1000000n)),
              userIdentifier: res.locals && res.locals.monitoringUserIdentifier || req.userId || null,
              source: settings.source || "unknown"
            });
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

  return { monitorBusinessEvent, recordMonitorEvent };
}

const recorder = createBusinessEventRecorder();

module.exports = {
  createBusinessEventRecorder,
  monitorBusinessEvent: recorder.monitorBusinessEvent,
  recordMonitorEvent: recorder.recordMonitorEvent
};
