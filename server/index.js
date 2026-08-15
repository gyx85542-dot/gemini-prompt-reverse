import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { createApp } from "./app.js";
import { openDb } from "./db.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env") });

const dataDir = path.join(root, "data");
fs.mkdirSync(path.join(dataDir, "uploads"), { recursive: true });

const db = openDb(path.join(dataDir, "app.db"));
const app = createApp({
  db,
  dataDir,
  apiKey: process.env.APIMART_API_KEY || "",
  baseUrl: process.env.APIMART_BASE_URL || "https://api.apimart.ai/v1",
});

const vite = await createViteServer({
  configFile: path.join(root, "web/vite.config.js"),
  server: { middlewareMode: true },
  appType: "spa",
});
app.use(vite.middlewares);

const port = Number(process.env.PORT || 8787);
app.listen(port, () => {
  console.log(`反推工具 http://localhost:${port}`);
});
