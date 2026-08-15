import { useEffect, useMemo, useState } from "react";
import { fetchJSON, filesFromCard, readSSE } from "./api.js";

const UI_KEY = "reverse-ui-v1";
const DEFAULT_MODEL = "gemini-3.5-flash";

function loadUi() {
  try {
    return JSON.parse(localStorage.getItem(UI_KEY) || "{}");
  } catch {
    return {};
  }
}

function isImageFile(file) {
  return /^image\/(jpeg|png|webp|gif)$/.test(file.type);
}

function imagesFromClipboard(e) {
  const fromFiles = [...(e.clipboardData?.files || [])].filter(isImageFile);
  const fromItems = [...(e.clipboardData?.items || [])]
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file) => file && isImageFile(file));
  return fromFiles.length ? fromFiles : fromItems;
}

function emptyDraft(source = null) {
  return {
    localId: crypto.randomUUID(),
    userText: source?.user_text || "",
    systemPrompt: source?.system_prompt || "",
    presetId: source?.preset_id || "",
    presetName: source?.preset_name || "",
    model: source?.model || DEFAULT_MODEL,
    customModel: "",
    sourceCardId: source?.id || null,
    files: [],
    previews: (source?.images || []).map((img) => `/uploads/${img.file_path}`),
    keepFrom: source,
    error: "",
    running: false,
  };
}

function clampLines(size) {
  if (size < 180) return 2;
  if (size < 260) return 3;
  return 4;
}

function formatTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startThat = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((startToday - startThat) / 86400000);
  if (days === 0) return `今天 ${hm}`;
  if (days === 1) return `昨天 ${hm}`;
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

function shortModel(model) {
  return String(model || "").replace(/^gemini-/, "");
}


export function App() {
  const [cards, setCards] = useState([]);
  const [presets, setPresets] = useState([]);
  const [models, setModels] = useState([DEFAULT_MODEL]);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [cardSize, setCardSize] = useState(() => Number(loadUi().cardSize) || 220);
  const [drafts, setDrafts] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [presetOpen, setPresetOpen] = useState(false);
  const [flashId, setFlashId] = useState(null);

  function patchDraft(localId, updater) {
    setDrafts((list) => list.map((d) => {
      if (d.localId !== localId) return d;
      const next = typeof updater === "function" ? updater(d) : { ...d, ...updater };
      return { ...next, localId };
    }));
  }

  function discardDraft(localId) {
    const target = drafts.find((d) => d.localId === localId) || drafts.find((d) => !d.running);
    if (!target || target.running) return;
    const dirty = Boolean(
      target.userText.trim() ||
      target.systemPrompt.trim() ||
      target.files.length ||
      target.keepFrom
    );
    if (dirty && !window.confirm("放弃这张未完成的草稿？")) return;
    setDrafts((list) => list.filter((d) => d.localId !== target.localId));
  }

  function locateCard(id) {
    setFlashId(id);
    window.setTimeout(() => {
      document.getElementById(`card-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 30);
    window.setTimeout(() => setFlashId((cur) => (cur === id ? null : cur)), 1400);
  }

  async function reload() {
    const [c, p, m] = await Promise.all([
      fetchJSON(`/api/cards?q=${encodeURIComponent(search)}`),
      fetchJSON("/api/presets"),
      fetchJSON("/api/models"),
    ]);
    setCards(c);
    setPresets(p);
    setModels(m.options || [DEFAULT_MODEL]);
  }

  useEffect(() => {
    const timer = setTimeout(() => setSearch(query), 280);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    reload().catch((err) => console.error(err));
  }, [search]);

  const newestDraft = drafts[0] || null;
  const draftFocus = newestDraft ? `${newestDraft.localId}:${newestDraft.sourceCardId ? "system" : "user"}` : "";
  useEffect(() => {
    if (!newestDraft) return;
    const field = newestDraft.sourceCardId ? "field-system" : "field-user";
    document.querySelector(`#draft-${newestDraft.localId} .${field}`)?.focus();
  }, [draftFocus]);

  useEffect(() => {
    localStorage.setItem(UI_KEY, JSON.stringify({ v: 1, cardSize }));
    document.documentElement.style.setProperty("--card-size", `${cardSize}px`);
  }, [cardSize]);

  useEffect(() => {
    function onKey(e) {
      if (e.key !== "Escape") return;
      if (document.activeElement?.classList.contains("search")) {
        if (query) {
          setQuery("");
          return;
        }
        document.activeElement.blur();
        return;
      }
      if (presetOpen) {
        setPresetOpen(false);
        return;
      }
      if (openId != null) {
        setOpenId(null);
        return;
      }
      const host = document.activeElement?.closest?.(".card.draft");
      const id = host?.id?.startsWith("draft-") ? host.id.slice(6) : null;
      discardDraft(id);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [presetOpen, openId, drafts, query]);

  useEffect(() => {
    function onPaste(e) {
      if (presetOpen || openId != null) return;
      const incoming = imagesFromClipboard(e);
      if (!incoming.length) return;
      const tag = e.target?.tagName;
      if (tag !== "TEXTAREA" && tag !== "INPUT") e.preventDefault();
      const host = e.target?.closest?.(".card.draft");
      const hostId = host?.id?.startsWith("draft-") ? host.id.slice(6) : null;
      setDrafts((list) => {
        const target = list.find((d) => d.localId === hostId && !d.running)
          || list.find((d) => !d.running);
        const add = (base) => {
          const files = [...base.files, ...incoming];
          return { ...base, files, previews: files.map((f) => URL.createObjectURL(f)), keepFrom: null };
        };
        if (!target) return [add(emptyDraft()), ...list];
        return list.map((d) => (d.localId === target.localId ? add(d) : d));
      });
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [presetOpen, openId]);

  useEffect(() => {
    const lock = presetOpen || openId != null;
    const prev = document.body.style.overflow;
    document.body.style.overflow = lock ? "hidden" : prev;
    return () => {
      document.body.style.overflow = prev;
    };
  }, [presetOpen, openId]);

  useEffect(() => {
    function onArrow(e) {
      if (openId == null || presetOpen) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const idx = cards.findIndex((c) => c.id === openId);
      if (idx < 0) return;
      const next = e.key === "ArrowLeft" ? idx - 1 : idx + 1;
      if (next < 0 || next >= cards.length) return;
      e.preventDefault();
      setOpenId(cards[next].id);
      locateCard(cards[next].id);
    }
    window.addEventListener("keydown", onArrow);
    return () => window.removeEventListener("keydown", onArrow);
  }, [openId, cards, presetOpen]);

  useEffect(() => {
    function onSlash(e) {
      if (presetOpen || openId != null) return;
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target?.isContentEditable) return;
      e.preventDefault();
      document.querySelector(".search")?.focus();
    }
    window.addEventListener("keydown", onSlash);
    return () => window.removeEventListener("keydown", onSlash);
  }, [presetOpen, openId]);

  const openCard = useMemo(() => cards.find((c) => c.id === openId) || null, [cards, openId]);
  const lines = clampLines(cardSize);

  function applyPreset(id, setter) {
    const preset = presets.find((p) => String(p.id) === String(id));
    setter((d) => ({
      ...d,
      presetId: id,
      presetName: preset?.name || "",
      systemPrompt: preset ? preset.body : d.systemPrompt,
    }));
  }

  async function submitDraft(current, retryId) {
    if (current.running) return;
    const model = current.model === "custom" ? current.customModel.trim() : current.model;
    if (current.model === "custom" && !model) {
      patchDraft(current.localId, { error: "请填写自定义模型名" });
      return;
    }
    let files = current.files;
    if (!files.length && current.keepFrom) {
      files = await filesFromCard(current.keepFrom);
    }
    if (!current.userText.trim() && files.length === 0) {
      patchDraft(current.localId, { error: "请至少上传一张图或输入一段文字" });
      return;
    }
    const body = new FormData();
    body.set("user_text", current.userText);
    body.set("system_prompt", current.systemPrompt);
    if (current.presetId) body.set("preset_id", String(current.presetId));
    if (current.presetName) body.set("preset_name", current.presetName);
    body.set("model", model || DEFAULT_MODEL);
    if (current.sourceCardId && !retryId) body.set("source_card_id", String(current.sourceCardId));
    for (const file of files) body.append("images", file);

    patchDraft(current.localId, { running: true, error: "" });
    const url = retryId ? `/api/cards/${retryId}/retry` : "/api/cards";
    let liveId = retryId || null;
    try {
      const res = await fetch(url, { method: "POST", body });
      await readSSE(res, (evt) => {
        if (evt.type === "card" || evt.type === "done") {
          liveId = evt.card.id;
          setCards((prev) => [evt.card, ...prev.filter((c) => c.id !== evt.card.id)]);
          if (evt.type === "card" && current.localId) {
            setDrafts((list) => list.filter((d) => d.localId !== current.localId));
          }
          if (evt.type === "done") {
            setOpenId(evt.card.id);
            locateCard(evt.card.id);
          }
        }
        if (evt.type === "delta" && liveId) {
          setCards((prev) => prev.map((c) => (c.id === liveId ? { ...c, output: evt.text, status: "running" } : c)));
        }
      });
      await reload();
    } catch (err) {
      patchDraft(current.localId, { running: false, error: err.message });
    }
  }

  function startNewDraft() {
    setOpenId(null);
    setPresetOpen(false);
    const next = emptyDraft();
    setDrafts((list) => [next, ...list]);
    window.setTimeout(() => {
      document.getElementById(`draft-${next.localId}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 30);
  }

  useEffect(() => {
    function onNew(e) {
      if (e.key !== "n" && e.key !== "N") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (presetOpen || openId != null) return;
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target?.isContentEditable) return;
      e.preventDefault();
      startNewDraft();
    }
    window.addEventListener("keydown", onNew);
    return () => window.removeEventListener("keydown", onNew);
  }, [presetOpen, openId]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">提示词反推</div>
        <div className="search-wrap">
          <input className="search" placeholder="搜索输入、系统提示词、产出（/）" value={query} onChange={(e) => setQuery(e.target.value)} />
          {query ? (
            <button className="search-clear" type="button" aria-label="清空搜索" onClick={() => { setQuery(""); document.querySelector(".search")?.focus(); }}>
              ×
            </button>
          ) : null}
        </div>
        <span className="kicker search-count">
          {search ? `匹配 ${cards.length} 条` : `${cards.length} 条`}
        </span>
        <label className="size-wrap">
          卡片大小
          <input type="range" min="150" max="340" value={cardSize} onChange={(e) => setCardSize(Number(e.target.value))} />
        </label>
        <button className="btn" type="button" onClick={() => setPresetOpen(true)}>管理预设</button>
        <button className="btn btn-accent" type="button" onClick={startNewDraft} title="N">
          新建反推
        </button>
      </header>

      <main
        className="wall"
        style={{ "--card-size": `${cardSize}px` }}
        onDragOver={(e) => {
          if ([...e.dataTransfer.types].includes("Files")) e.preventDefault();
        }}
        onDrop={(e) => {
          if (e.target.closest(".card.draft")) return;
          const incoming = [...e.dataTransfer.files].filter(isImageFile);
          if (!incoming.length) return;
          e.preventDefault();
          const next = emptyDraft();
          next.files = incoming;
          next.previews = incoming.map((f) => URL.createObjectURL(f));
          setDrafts((list) => [next, ...list]);
        }}
      >
        {drafts.map((draft) => (
          <article key={draft.localId} id={`draft-${draft.localId}`} className="card draft">
            <DraftForm
              draft={draft}
              setDraft={(next) => patchDraft(draft.localId, next)}
              presets={presets}
              models={models}
              onPreset={(id) => applyPreset(id, (fn) => patchDraft(draft.localId, fn))}
              onSubmit={() => submitDraft(draft)}
              onCancel={() => discardDraft(draft.localId)}
            />
          </article>
        ))}
        {cards.map((card) => (
          <SavedCard
            key={card.id}
            card={card}
            lines={lines}
            onOpen={() => setOpenId(card.id)}
            flash={flashId === card.id}
            onJump={(id) => {
              setOpenId(id);
              locateCard(id);
            }}
          />
        ))}
      </main>
      {!drafts.length && cards.length === 0 ? (
        <p className="empty">
          {search
            ? `没有匹配「${search}」的卡片`
            : "还没有反推。点右上角「新建反推」开始。"}
        </p>
      ) : null}

      {openCard ? (
        <CardModal
          key={openCard.id}
          card={openCard}
          presets={presets}
          models={models}
          onClose={() => setOpenId(null)}
          onRerun={async () => {
            const next = emptyDraft(openCard);
            next.files = await filesFromCard(openCard);
            next.previews = next.files.map((f) => URL.createObjectURL(f));
            setOpenId(null);
            setDrafts((list) => [next, ...list]);
          }}
          onRetry={(form) => submitDraft(form, openCard.id)}
        />
      ) : null}

      {presetOpen ? (
        <PresetModal
          presets={presets}
          onClose={() => setPresetOpen(false)}
          onChange={async () => {
            setPresets(await fetchJSON("/api/presets"));
          }}
          onCreated={(preset) => {
            if (!drafts.length) return;
            patchDraft(drafts[0].localId, {
              presetId: preset.id,
              presetName: preset.name,
              systemPrompt: preset.body,
            });
          }}
        />
      ) : null}
    </div>
  );
}

function DraftForm({ draft, setDraft, presets, models, onPreset, onSubmit, onCancel }) {
  const [dragOver, setDragOver] = useState(false);

  function onFiles(list) {
    const incoming = Array.from(list || []).filter(isImageFile);
    if (!incoming.length) return;
    const files = [...draft.files, ...incoming];
    setDraft({
      ...draft,
      files,
      previews: files.map((f) => URL.createObjectURL(f)),
      keepFrom: null,
    });
  }

  return (
    <div
      className={`editor${dragOver ? " drop-on" : ""}`}
      onClick={(e) => e.stopPropagation()}
      onDragEnter={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setDragOver(true); }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(false);
        onFiles(e.dataTransfer.files);
      }}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !draft.running) {
          e.preventDefault();
          onSubmit();
        }
      }}
    >
      <div className="kicker">{draft.sourceCardId ? `再跑 · 来自 #${draft.sourceCardId}` : "新卡片"}</div>
      <label className="btn file-btn">
        {dragOver ? "松开即可加入图片" : "添加图片 / 拖入 / Ctrl+V"}
        <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple onChange={(e) => onFiles(e.target.files)} />
      </label>
      <div className="previews">
        {draft.previews.map((src, i) => (
          <button
            key={src + i}
            type="button"
            onClick={() => {
              const files = draft.files.filter((_, idx) => idx !== i);
              setDraft({
                ...draft,
                files,
                previews: files.length ? files.map((f) => URL.createObjectURL(f)) : [],
                keepFrom: files.length ? draft.keepFrom : null,
              });
            }}
            title="移除"
          >
            <img src={src} alt="" />
          </button>
        ))}
      </div>
      <textarea className="field-user" placeholder="文字（可选）" value={draft.userText} onChange={(e) => setDraft({ ...draft, userText: e.target.value })} />
      <div className="row">
        <select value={draft.presetId} onChange={(e) => onPreset(e.target.value)}>
          <option value="">选择预设</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <select
          value={models.includes(draft.model) || draft.model === "custom" ? draft.model : "custom"}
          onChange={(e) => setDraft({ ...draft, model: e.target.value, customModel: e.target.value === "custom" ? draft.customModel : "" })}
        >
          {models.map((m) => <option key={m} value={m}>{m}</option>)}
          <option value="custom">自定义</option>
        </select>
      </div>
      {(draft.model === "custom" || !models.includes(draft.model)) && (
        <input placeholder="自定义模型名" value={draft.customModel || (!models.includes(draft.model) ? draft.model : "")} onChange={(e) => setDraft({ ...draft, model: "custom", customModel: e.target.value })} />
      )}
      <textarea className="field-system" placeholder="系统提示词" value={draft.systemPrompt} onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })} />
      {draft.sourceCardId ? <p className="kicker">来自 #{draft.sourceCardId}</p> : null}
      {draft.error ? <p className="err">{draft.error}</p> : null}
      <div className="row">
        <button className="btn btn-accent" type="button" disabled={draft.running} onClick={onSubmit} title="Ctrl+Enter">
          {draft.running ? "反推中…" : "开始反推"}
        </button>
        {onCancel ? (
          <button className="btn" type="button" disabled={draft.running} onClick={onCancel}>取消</button>
        ) : null}
      </div>
    </div>
  );
}

function SavedCard({ card, lines, onOpen, onJump, flash }) {
  const imgs = card.images || [];
  const [copied, setCopied] = useState(false);

  async function copyOutput(e) {
    e.stopPropagation();
    if (!card.output) return;
    try {
      await navigator.clipboard.writeText(card.output);
    } catch {
      const area = document.createElement("textarea");
      area.value = card.output;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <article id={`card-${card.id}`} className={`card clickable ${card.status}${flash ? " flash" : ""}`} onClick={onOpen}>
      <div className="thumbs">
        {imgs.length === 0 ? <div className="ph" /> : imgs.map((img) => (
          <img key={img.id} src={`/uploads/${img.file_path}`} alt={img.original_name} />
        ))}
      </div>
      <div className="body">
        <div className="kicker">{card.preset_name || "产出"}</div>
        <p className="clip" style={{ WebkitLineClamp: lines }} title={card.output || card.error || ""}>
          {card.output || card.error || (card.status === "failed" ? "失败，尚未产出" : "尚无产出")}
        </p>
        {card.user_text ? <p className="clip s" style={{ WebkitLineClamp: Math.max(1, lines - 1) }} title={card.user_text}>{card.user_text}</p> : null}
        {!card.preset_name && card.system_prompt ? (
          <p className="clip s" style={{ WebkitLineClamp: Math.max(1, lines - 1) }} title={card.system_prompt}>
            {card.system_prompt}
          </p>
        ) : null}
        <div className="meta">
          <span>{shortModel(card.model)} · {formatTime(card.created_at)}</span>
          <span className={`badge ${card.status === "succeeded" ? "ok" : card.status === "failed" ? "bad" : "run"}`}>
            {card.status === "succeeded" ? "成功" : card.status === "failed" ? "失败" : "进行中"}
          </span>
        </div>
        <div className="card-actions">
          {card.output ? (
            <button className="source" type="button" onClick={copyOutput}>
              {copied ? "已复制" : "复制"}
            </button>
          ) : null}
          {card.source_card_id ? (
            <button className="source" type="button" onClick={(e) => { e.stopPropagation(); onJump(card.source_card_id); }}>
              来自 #{card.source_card_id}
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function FoldSection({ title, open, onToggle, children }) {
  return (
    <section className={`fold${open ? " is-open" : ""}`}>
      <button type="button" className="fold-head" onClick={onToggle} aria-expanded={open}>
        <span>{title}</span>
        <span className="fold-mark">{open ? "收起" : "展开"}</span>
      </button>
      {open ? <div className="fold-body">{children}</div> : null}
    </section>
  );
}

function CardModal({ card, presets, models, onClose, onRerun, onRetry }) {
  const failed = card.status === "failed";
  const [form, setForm] = useState(() => ({ ...emptyDraft(card), sourceCardId: null }));
  const [copied, setCopied] = useState(false);
  const [zoom, setZoom] = useState(null);
  const [openParts, setOpenParts] = useState({ images: true, system: false, user: false, output: true });

  function togglePart(key) {
    setOpenParts((cur) => ({ ...cur, [key]: !cur[key] }));
  }

  useEffect(() => {
    function onKey(e) {
      if (e.key !== "Escape" || !zoom) return;
      e.stopPropagation();
      e.preventDefault();
      setZoom(null);
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [zoom]);

  async function copyOutput() {
    const text = card.output || "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  useEffect(() => {
    function onKey(e) {
      if (!(e.ctrlKey || e.metaKey) || e.key !== "c") return;
      if (failed) return;
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (window.getSelection()?.toString()) return;
      if (!card.output) return;
      e.preventDefault();
      copyOutput();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card.output, failed]);

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>
            {card.preset_name || (card.status === "failed" ? "失败卡片" : "反推结果")}
            <span className="kicker"> #{card.id} · ← → 切换</span>
          </h2>
          <p className="kicker">{card.model} · {formatTime(card.created_at)}</p>
        </div>
        {failed ? (
          <DraftForm
            draft={form}
            setDraft={setForm}
            presets={presets}
            models={models}
            onPreset={(id) => {
              const preset = presets.find((p) => String(p.id) === String(id));
              setForm((d) => ({ ...d, presetId: id, presetName: preset?.name || "", systemPrompt: preset ? preset.body : d.systemPrompt }));
            }}
            onSubmit={() => onRetry(form)}
            onCancel={onClose}
          />
        ) : (
          <>
            <div className="modal-body">
              {(card.images || []).length ? (
                <FoldSection title={`参考图（${card.images.length}）`} open={openParts.images} onToggle={() => togglePart("images")}>
                  <div className="modal-imgs">
                    {card.images.map((img) => (
                      <img
                        key={img.id}
                        src={`/uploads/${img.file_path}`}
                        alt={img.original_name}
                        title="点击看大图"
                        onClick={() => setZoom(`/uploads/${img.file_path}`)}
                      />
                    ))}
                  </div>
                </FoldSection>
              ) : null}
              <FoldSection title="系统提示词" open={openParts.system} onToggle={() => togglePart("system")}>
                <p className="full">{card.system_prompt || "（未填写）"}</p>
              </FoldSection>
              {card.user_text ? (
                <FoldSection title="用户文字" open={openParts.user} onToggle={() => togglePart("user")}>
                  <p className="full">{card.user_text}</p>
                </FoldSection>
              ) : null}
              <FoldSection title="产出" open={openParts.output} onToggle={() => togglePart("output")}>
                <p
                  className="full selectable"
                  title="点击全选"
                  onClick={(e) => {
                    const range = document.createRange();
                    range.selectNodeContents(e.currentTarget);
                    const sel = window.getSelection();
                    sel.removeAllRanges();
                    sel.addRange(range);
                  }}
                >
                  {card.output || ""}
                </p>
              </FoldSection>
              {card.error ? <p className="err">{card.error}</p> : null}
            </div>
            <div className="modal-foot row">
              <button className="btn btn-accent" type="button" onClick={copyOutput} disabled={!card.output} title="Ctrl+C">
                {copied ? "已复制" : "复制产出"}
              </button>
              <button className="btn" type="button" onClick={onRerun}>用新系统提示词再跑</button>
              <button className="btn" type="button" onClick={onClose}>关闭</button>
            </div>
          </>
        )}
      </div>
      {zoom ? (
        <div className="zoom-bg" onClick={() => setZoom(null)}>
          <img src={zoom} alt="" />
        </div>
      ) : null}
    </div>
  );
}

function PresetModal({ presets, onClose, onChange, onCreated }) {
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [edits, setEdits] = useState({});
  const [savedId, setSavedId] = useState(null);

  async function create() {
    try {
      const created = await fetchJSON("/api/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, body }),
      });
      setName("");
      setBody("");
      setError("");
      await onChange();
      onCreated?.(created);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal modal-presets" onClick={(e) => e.stopPropagation()}>
        <div className="preset-head">
          <h2>系统提示词预设</h2>
          <button className="btn" type="button" onClick={onClose}>关闭</button>
        </div>
        <section className="preset-form">
          <label>
            名称
            <input
              placeholder="例如：镜头反推"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === "Enter") {
                  e.preventDefault();
                  create();
                }
              }}
            />
          </label>
          <label>
            全文
            <textarea
              placeholder="系统提示词全文（Ctrl+Enter 新建）"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                  e.preventDefault();
                  create();
                }
              }}
            />
          </label>
          {error ? <p className="err">{error}</p> : null}
          <div className="preset-actions">
            <button className="btn btn-accent" type="button" onClick={create} title="名称框回车，或全文 Ctrl+Enter">新建预设</button>
          </div>
        </section>
        <div className="preset-list">
          {presets.map((p) => {
            const edit = edits[p.id] || { name: p.name, body: p.body };
            return (
              <section key={p.id} className="preset-item">
                <label>
                  名称
                  <input value={edit.name} onChange={(e) => setEdits({ ...edits, [p.id]: { ...edit, name: e.target.value } })} />
                </label>
                <label>
                  全文
                  <textarea value={edit.body} onChange={(e) => setEdits({ ...edits, [p.id]: { ...edit, body: e.target.value } })} />
                </label>
                <div className="preset-actions">
                  <button className="btn" type="button" onClick={async () => {
                    await fetchJSON(`/api/presets/${p.id}`, {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(edit),
                    });
                    await onChange();
                    setSavedId(p.id);
                    window.setTimeout(() => setSavedId((cur) => (cur === p.id ? null : cur)), 1500);
                  }}>{savedId === p.id ? "已保存" : "保存"}</button>
                  <button className="btn btn-ghost" type="button" onClick={async () => {
                    if (!window.confirm(`删除预设「${edit.name}」？已有卡片里的提示词不会变。`)) return;
                    await fetchJSON(`/api/presets/${p.id}`, { method: "DELETE" });
                    onChange();
                  }}>删除</button>
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
