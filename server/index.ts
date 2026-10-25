/**
 * BalaBot Modern Server Entrypoint (Pi Durable Engine)
 */

import * as fs from "node:fs";

// Load local environment files
if (fs.existsSync(".env")) {
  try {
    process.loadEnvFile(".env");
  } catch (err) {
    console.warn("Could not load .env file:", err);
  }
}
if (fs.existsSync(".env.local")) {
  try {
    process.loadEnvFile(".env.local");
  } catch {}
}

import { BalaBotServer } from "./api.js";

const port = parseInt(process.env.BALABOT_PORT || "9119", 10);
const server = new BalaBotServer({ port });

console.log(`Starting BalaBot Pi Durable Server on 127.0.0.1:${port}...`);
server.listen().then(() => {
  console.log(`BalaBot Pi Durable Server listening on http://127.0.0.1:${port}`);
  console.log(`Engine: @earendil-works/pi-durable + SQLite Persistence (Zero Docker)`);
}).catch(err => {
  console.error("Failed to start server:", err);
  process.exit(1);
});

process.on("SIGINT", async () => {
  console.log("Shutting down BalaBot Server gracefully...");
  await server.close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("Shutting down BalaBot Server gracefully...");
  await server.close();
  process.exit(0);
});
