// Loads a database backup made by backup.mjs.
//
//   npm run restore -- backups/db/2026-11-19-02-00-00.sql.gz --yes
//
// It replaces every mg_ table in APP_DB_NAME with the tables in the file. Everything changed since that backup is
// lost, so it asks for --yes. To look at a backup without touching the live data, load it into another database:
//
//   APP_DB_NAME=magazine_restore_test npm run restore -- <file> --yes
//
// The files (PDFs, adverts, uploads) are restored by copying backups/files/* back into the data folder.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Set before the .env files are read, so a database named on the command line wins.
const named = process.env.APP_DB_NAME;
for (const name of [".env.local", ".env"]) {
  const file = path.join(root, name);
  if (fs.existsSync(file)) process.loadEnvFile(file);
}
if (named) process.env.APP_DB_NAME = named;

const args = process.argv.slice(2);
const file = args.find((arg) => !arg.startsWith("--"));
const dbName = process.env.APP_DB_NAME || "magazine_generator";
if (!file || !fs.existsSync(file)) {
  console.error("Name the backup file to load, for example: npm run restore -- backups/db/2026-11-19-02-00-00.sql.gz --yes");
  process.exit(1);
}
if (!/^[A-Za-z0-9_]+$/.test(dbName)) {
  console.error("APP_DB_NAME may only contain letters, digits and underscores.");
  process.exit(1);
}
if (!args.includes("--yes")) {
  console.error(`This replaces every mg_ table in database "${dbName}" with the backup ${path.basename(file)}.\nEverything changed since that backup is lost. Add --yes to go ahead.`);
  process.exit(1);
}

const raw = fs.readFileSync(file);
const sql = (file.endsWith(".gz") ? zlib.gunzipSync(raw) : raw).toString("utf8");
const conn = await mysql.createConnection({
  host: process.env.NEWS_DB_HOST || "localhost",
  port: Number(process.env.NEWS_DB_PORT || 3306),
  user: process.env.NEWS_DB_USER,
  password: process.env.NEWS_DB_PASSWORD,
  multipleStatements: true,
  charset: "utf8mb4",
});
try {
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4`);
  await conn.query(`USE \`${dbName}\``);
  await conn.query(sql);
  const [tables] = await conn.query("SHOW TABLES LIKE 'mg\\_%'");
  const [[editions]] = await conn.query("SELECT COUNT(*) AS n FROM mg_editions");
  console.log(`Restored ${tables.length} tables into "${dbName}" from ${path.basename(file)}: ${editions.n} edition(s).`);
} catch (error) {
  console.error("RESTORE FAILED:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await conn.end();
}
