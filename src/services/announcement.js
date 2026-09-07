const DEFAULT_TITLE = "太小科校园助手用户反馈群";
const DEFAULT_CONTENT = "遇到绑定失败、成绩异常、课表问题，或者有功能建议，都可以进群反馈。";
const DEFAULT_BANNER = "遇到问题？加入反馈群 →";

function booleanValue(value, fallback) {
  const text = String(value == null ? "" : value).trim().toLowerCase();
  if (!text) return Boolean(fallback);
  return ["1", "true", "yes", "on"].includes(text);
}

function limitedText(value, fallback, maxLength) {
  const text = String(value || fallback || "").trim();
  return text.slice(0, maxLength);
}

function httpsImageUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const parsed = new URL(text);
    return parsed.protocol === "https:" ? parsed.toString() : "";
  } catch (_) {
    return "";
  }
}

function cooldownHours(value) {
  const hours = Number(value);
  if (!Number.isFinite(hours)) return 24;
  return Math.max(1, Math.min(168, Math.round(hours)));
}

function announcementConfig(environment) {
  const env = environment || process.env;
  const requestedEnabled = booleanValue(env.ANNOUNCEMENT_ENABLED, false);
  const version = limitedText(env.ANNOUNCEMENT_VERSION, "", 120);
  const imageUrl = httpsImageUrl(env.ANNOUNCEMENT_IMAGE_URL);
  const enabled = Boolean(requestedEnabled && version && imageUrl);

  return {
    enabled,
    version,
    type: "feedback_group",
    title: limitedText(env.ANNOUNCEMENT_TITLE, DEFAULT_TITLE, 80),
    content: limitedText(env.ANNOUNCEMENT_CONTENT, DEFAULT_CONTENT, 500),
    imageUrl,
    homeBannerText: limitedText(env.ANNOUNCEMENT_HOME_BANNER_TEXT, DEFAULT_BANNER, 80),
    showPopup: enabled && booleanValue(env.ANNOUNCEMENT_SHOW_POPUP, true),
    popupCooldownHours: cooldownHours(env.ANNOUNCEMENT_POPUP_COOLDOWN_HOURS)
  };
}

module.exports = { announcementConfig };
