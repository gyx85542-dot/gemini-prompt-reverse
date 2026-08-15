import { EMPTY_IMAGE_USER_TEXT } from "./logic.js";

export function buildMessages({ systemPrompt, userText, images }) {
  const messages = [];
  const sys = String(systemPrompt || "").trim();
  if (sys) messages.push({ role: "system", content: sys });

  const hasImages = Boolean(images && images.length);
  const text = String(userText || "").trim() || (hasImages ? EMPTY_IMAGE_USER_TEXT : "");
  const content = [];
  if (text) content.push({ type: "text", text });
  for (const img of images || []) {
    content.push({
      type: "image_url",
      image_url: { url: `data:${img.mime};base64,${img.base64}` },
    });
  }
  messages.push({ role: "user", content });
  return messages;
}

export async function streamChat({ apiKey, baseUrl, model, messages, onDelta, signal }) {
  const url = `${String(baseUrl).replace(/\/$/, "")}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages, stream: true }),
    signal,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`APIMart ${res.status}: ${body.slice(0, 500)}`);
  }
  if (!res.body) throw new Error("APIMart 未返回流");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n");
    buffer = chunks.pop() || "";
    for (const line of chunks) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const json = JSON.parse(data);
        const piece = json.choices?.[0]?.delta?.content || "";
        if (piece) {
          full += piece;
          onDelta?.(piece, full);
        }
      } catch {
        // ignore keep-alive / incomplete json
      }
    }
  }
  return full;
}
