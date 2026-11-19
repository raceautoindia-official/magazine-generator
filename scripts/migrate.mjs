// Creates the generator database (if allowed) and applies db/migrations/*.sql in order.
// Usage: npm run migrate
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const name of [".env.local", ".env"]) {
  const file = path.join(root, name);
  if (fs.existsSync(file)) process.loadEnvFile(file);
}

const need = (key) => {
  const value = process.env[key];
  if (!value) {
    console.error(`Missing ${key}. Fill in .env.local (see .env.example).`);
    process.exit(1);
  }
  return value;
};

const dbName = process.env.APP_DB_NAME || "magazine_generator";
if (!/^[A-Za-z0-9_]+$/.test(dbName)) {
  console.error("APP_DB_NAME may only contain letters, digits and underscores.");
  process.exit(1);
}

const conn = await mysql.createConnection({
  host: process.env.NEWS_DB_HOST || "localhost",
  port: Number(process.env.NEWS_DB_PORT || 3306),
  user: need("NEWS_DB_USER"),
  password: need("NEWS_DB_PASSWORD"),
  multipleStatements: true,
});

try {
  try {
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4`);
  } catch (err) {
    console.error(
      `Could not create database "${dbName}" (${err.code}). ` +
        `Either grant the user CREATE on it, or set APP_DB_NAME=race_news to keep the mg_ tables there.`,
    );
    process.exit(1);
  }
  await conn.query(`USE \`${dbName}\``);
  await conn.query(
    `CREATE TABLE IF NOT EXISTS mg_schema_migrations (
       name VARCHAR(255) NOT NULL PRIMARY KEY,
       applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
     ) ENGINE=InnoDB`,
  );
  const [rows] = await conn.query("SELECT name FROM mg_schema_migrations");
  const done = new Set(rows.map((r) => r.name));
  const dir = path.join(root, "db", "migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  let applied = 0;
  for (const file of files) {
    if (done.has(file)) continue;
    await conn.query(fs.readFileSync(path.join(dir, file), "utf8"));
    await conn.query("INSERT INTO mg_schema_migrations (name) VALUES (?)", [file]);
    console.log(`applied ${file}`);
    applied++;
  }
  console.log(applied ? `Done: ${applied} migration(s) applied to ${dbName}.` : `Nothing to do: ${dbName} is up to date.`);
} finally {
  await conn.end();
}
