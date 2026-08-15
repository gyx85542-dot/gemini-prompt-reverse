# Gemini 提示词反推工具 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. User ordered immediate inline execution — do not pause for execution-mode choice.

**Goal:** 本机单页卡片墙：图/文 + 系统提示词经 APIMart Gemini 反推，结果持久化，可搜索、可改系统提示词再跑新卡。

**Architecture:** 一个 Node 进程（端口 8787）托管 Express API 与 Vite 前端。SQLite（`node:sqlite`）存预设和卡片，图片落在 `data/uploads/`。后端用 API Key 流式转发 `https://api.apimart.ai/v1/chat/completions`。

**Tech Stack:** Node 22, Express, `node:sqlite`, Vite, React, node:test

## Global Constraints

- 默认模型 `gemini-3.5-flash`；每卡可选固定 Gemini 列表或自定义名
- 图文都可空，开跑至少一样；单图 ≤ 10MB；jpg/png/webp/gif
- 草稿未开跑不入库；失败同卡重试；改系统提示词再跑新建卡并写 `source_card_id`
- API Key 仅 `.env` 的 `APIMART_API_KEY`；默认 base `https://api.apimart.ai/v1`
- 第一版不删卡片、不拆栏、不单独拉角缩放
- 无文字有图时 user text 占位：`请根据图片进行反推。`

## File map

- `server/logic.js` — 纯函数：开跑校验、搜索、图片校验、模型列表
- `server/logic.test.js` — node:test
- `server/db.js` — SQLite schema 与 CRUD
- `server/apimart.js` — 组 messages、流式读 APIMart
- `server/app.js` — Express 路由
- `server/index.js` — 监听 8787 + Vite middleware
- `web/src/App.jsx` 及卡片/预设组件
- `.env.example` `.gitignore` `package.json`

### Task 1: 纯逻辑 + 测试

- [x] 用户要求马上实现：本会话按 TDD 做 logic，再铺服务端与前端，最后启动验收。

### Task 2: 数据库与 API

- Presets CRUD；Cards 创建/列表/搜索/重试；multipart 图片；SSE 流式反推

### Task 3: 卡片墙 UI

- 平铺卡片、大小滑杆、搜索、预设管理、模型选择、放大层再跑

### Task 4: 启动验收

- `node --test server/logic.test.js` 通过；`npm run dev` 可打开工作台
