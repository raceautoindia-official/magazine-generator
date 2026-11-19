// Backs up everything the generator owns: its database tables and the files that cannot be made again.
//
//   npm run backup
//
// Writes into BACKUP_DIR (default ./backups, better a folder on another disk):
//   db/<date-time>.sql.gz   every mg_ table, as SQL that restore.mjs can load. The newest 14 are kept
//                           (BACKUP_KEEP changes that).
//   files/                  a copy of data/editions (PDFs, covers, uploaded pictures), data/adverts and
//                           data/finished. Files are added and updated, never removed, so a file deleted from the
//                           live folder by mistake is still here.
// data/cache is left out: those are the posts' pictures, fetched again from the website when needed.
//
// Run it nightly (see docs/05-user-guide.md, "Backups"). It exits with code 1 when anything fails.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const name of [".env.local", ".env"]) {
  const file = path.join(root, name);
  if (fs.existsSync(file)) process.loadEnvFile(file);
}
const need = (key) => {
  if (!process.env[key]) {
    console.error(`Missing ${key}. Fill in .env.local or .env (see .env.example).`);
    process.exit(1);
  }
  return process.env[key];
};

const dbName = process.env.APP_DB_NAME || "magazine_generator";
const dataDir = path.resolve(root, process.env.DATA_DIR || "./data");
const backupDir = path.resolve(root, process.env.BACKUP_DIR || "./backups");
const keep = Math.max(1, Number(process.env.BACKUP_KEEP || 14));
const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);

/** One value as it is written in an INSERT statement. */
function literal(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  if (Buffer.isBuffer(value)) return `X'${value.toString("hex")}'`;
  return mysql.escape(String(value));
}

async function dumpDatabase() {
  const conn = await mysql.createConnection({
    host: process.env.NEWS_DB_HOST || "localhost",
    port: Number(process.env.NEWS_DB_PORT || 3306),
    user: need("NEWS_DB_USER"),
    password: need("NEWS_DB_PASSWORD"),
    database: dbName,
    dateStrings: true,
    charset: "utf8mb4",
    // JSON columns as the text MySQL holds, not as parsed values: a stored string would otherwise lose its quotes.
    typeCast: (field, next) => (field.type === "JSON" ? field.string("utf8") : next()),
  });
  try {
    const [tables] = await conn.query("SHOW TABLES LIKE 'mg\\_%'");
    const names = tables.map((row) => Object.values(row)[0]).sort();
    if (names.length === 0) throw new Error(`No mg_ tables found in database "${dbName}".`);
    fs.mkdirSync(path.join(backupDir, "db"), { recursive: true });
    const file = path.join(backupDir, "db", `${stamp}.sql.gz`);
    const gzip = zlib.createGzip({ level: 6 });
    const out = fs.createWriteStream(`${file}.part`);
    gzip.pipe(out);
    const write = (text) => new Promise((resolve) => (gzip.write(text) ? resolve() : gzip.once("drain", resolve)));

    await write(`-- Magazine generator backup of database "${dbName}", made ${new Date().toISOString()}\n-- Load it with: npm run restore -- <this file>\nSET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS = 0;\n\n`);
    let rows = 0;
    for (const name of names) {
      const [[created]] = await conn.query(`SHOW CREATE TABLE \`${name}\``);
      await write(`DROP TABLE IF EXISTS \`${name}\`;\n${created["Create Table"]};\n`);
      const [data] = await conn.query(`SELECT * FROM \`${name}\``);
      if (data.length > 0) {
        const columns = Object.keys(data[0]).map((column) => `\`${column}\``).join(", ");
        for (let at = 0; at < data.length; at += 200) {
          const values = data.slice(at, at + 200).map((row) => `(${Object.values(row).map(literal).join(", ")})`);
          await write(`INSERT INTO \`${name}\` (${columns}) VALUES\n${values.join(",\n")};\n`);
        }
      }
      rows += data.length;
      await write("\n");
    }
    await write("SET FOREIGN_KEY_CHECKS = 1;\n");
    await new Promise((resolve, reject) => {
      out.on("finish", resolve);
      out.on("error", reject);
      gzip.end();
    });
    fs.renameSync(`${file}.part`, file);
    return { file, tables: names.length, rows };
  } finally {
    await conn.end();
  }
}

/** Copies what is new or changed (by size and time) from one folder into another; removes nothing. */
function mirror(from, to, counts) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) {
      // The pages of the on-screen reader and the page sent to the printer are made again with the PDF.
      if (entry.name === "pages" || entry.name === "pages.new") continue;
      mirror(source, target, counts);
    } else if (entry.isFile()) {
      if (entry.name.endsWith(".new") || entry.name.endsWith(".part")) continue;
      const here = fs.statSync(source);
      const there = fs.existsSync(target) ? fs.statSync(target) : null;
      counts.seen++;
      if (there && there.size === here.size && Math.abs(there.mtimeMs - here.mtimeMs) < 2000) continue;
      fs.copyFileSync(source, target);
      fs.utimesSync(target, here.atime, here.mtime);
      counts.copied++;
      counts.bytes += here.size;
    }
  }
}

try {
  const dump = await dumpDatabase();
  const kept = fs.readdirSync(path.join(backupDir, "db")).filter((name) => name.endsWith(".sql.gz")).sort();
  for (const old of kept.slice(0, Math.max(0, kept.length - keep))) fs.unlinkSync(path.join(backupDir, "db", old));

  const counts = { seen: 0, copied: 0, bytes: 0 };
  for (const folder of ["editions", "adverts", "finished"]) mirror(path.join(dataDir, folder), path.join(backupDir, "files", folder), counts);

  fs.writeFileSync(path.join(backupDir, "last-backup.json"), JSON.stringify({ at: new Date().toISOString(), database: path.basename(dump.file), tables: dump.tables, rows: dump.rows, files: counts.seen, copied: counts.copied }, null, 2));
  console.log(`Backup done in ${backupDir}`);
  console.log(`  database: ${path.basename(dump.file)} (${dump.tables} tables, ${dump.rows} rows, ${(fs.statSync(dump.file).size / 1024).toFixed(0)} KB); ${Math.min(kept.length, keep)} dump(s) kept`);
  console.log(`  files: ${counts.seen} in place, ${counts.copied} new or changed (${(counts.bytes / 1024 / 1024).toFixed(1)} MB copied)`);
} catch (error) {
  console.error("BACKUP FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
}
