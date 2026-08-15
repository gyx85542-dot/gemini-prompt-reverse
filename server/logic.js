export const DEFAULT_MODEL = "gemini-3.5-flash";

export const MODEL_OPTIONS = [
  "gemini-3.5-flash",
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.5-flash-lite",
  "gemini-3-flash-preview",
  "gemini-3-pro-preview",
];

export const EMPTY_IMAGE_USER_TEXT = "请根据图片进行反推。";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const ALLOWED_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export function canStartRun({ userText, imageCount }) {
  return Boolean((userText && userText.trim()) || imageCount > 0);
}

export function cardMatchesQuery(card, query) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return true;
  const hay = [card.user_text, card.system_prompt, card.output]
    .map((part) => String(part || "").toLowerCase())
    .join("\n");
  return hay.includes(needle);
}

export function validateImage({ mime, size }) {
  if (!ALLOWED_MIMES.has(mime)) {
    return { ok: false, error: "仅支持 jpg / png / webp / gif" };
  }
  if (size > MAX_IMAGE_BYTES) {
    return { ok: false, error: "单张图片不能超过 10MB" };
  }
  return { ok: true };
}

export function shortModelName(model) {
  if (!model) return "";
  return model.replace(/^gemini-/, "");
}
