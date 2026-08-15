export async function fetchJSON(url, options) {
  const res = await fetch(url, options);
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败 ${res.status}`);
  return data;
}

export async function readSSE(res, onEvent) {
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `请求失败 ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const raw = trimmed.slice(5).trim();
      if (!raw) continue;
      onEvent(JSON.parse(raw));
    }
  }
}

export async function filesFromCard(card) {
  const files = [];
  for (const img of card.images || []) {
    const res = await fetch(`/uploads/${img.file_path}`);
    const blob = await res.blob();
    files.push(new File([blob], img.original_name || "image", { type: img.mime }));
  }
  return files;
}
