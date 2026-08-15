import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, createPreset, listPresets, deletePreset, createCard, listCards, getCard, updateCard } from "./db.js";

function mem() {
  return openDb(":memory:");
}

test("preset name must be unique and delete does not throw", () => {
  const db = mem();
  const a = createPreset(db, { name: "镜头", body: "描述镜头" });
  assert.equal(a.name, "镜头");
  assert.throws(() => createPreset(db, { name: "镜头", body: "重复" }));
  deletePreset(db, a.id);
  assert.equal(listPresets(db).length, 0);
});

test("create card then list and search", () => {
  const db = mem();
  const card = createCard(db, {
    user_text: "红椅子",
    system_prompt: "反推提示词",
    preset_id: null,
    preset_name: null,
    model: "gemini-3.5-flash",
    source_card_id: null,
  });
  assert.equal(card.status, "running");
  assert.equal(listCards(db, "").length, 1);
  assert.equal(listCards(db, "椅子").length, 1);
  assert.equal(listCards(db, "没有").length, 0);
  updateCard(db, card.id, { status: "succeeded", output: "35mm chair" });
  const loaded = getCard(db, card.id);
  assert.equal(loaded.output, "35mm chair");
  assert.equal(listCards(db, "35mm").length, 1);
});
