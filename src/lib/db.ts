import "server-only";
import mysql, { type Pool, type RowDataPacket, type ResultSetHeader } from "mysql2/promise";
import { env } from "./env";

type Pools = { news?: Pool; app?: Pool };
const globalPools = globalThis as unknown as { __mgPools?: Pools };
const pools: Pools = (globalPools.__mgPools ??= {});

function createPool(database: string): Pool {
  const e = env();
  return mysql.createPool({
    host: e.NEWS_DB_HOST,
    port: e.NEWS_DB_PORT,
    user: e.NEWS_DB_USER,
    password: e.NEWS_DB_PASSWORD,
    database,
    waitForConnections: true,
    connectionLimit: 5,
    // Return DATETIME/TIMESTAMP as strings so no timezone shifting happens in Node.
    dateStrings: true,
    charset: "utf8mb4",
  });
}

type Param = string | number | boolean | null | Date;

/**
 * Main site database. Read only by construction: anything that is not a
 * single SELECT is refused before it reaches MySQL.
 */
export async function newsQuery<T = RowDataPacket>(sql: string, params: Param[] = []): Promise<T[]> {
  const statement = sql.trim().replace(/;\s*$/, "");
  if (!/^select\b/i.test(statement) || statement.includes(";")) {
    throw new Error("newsQuery only accepts a single SELECT statement");
  }
  pools.news ??= createPool(env().NEWS_DB_NAME);
  const [rows] = await pools.news.query<RowDataPacket[]>(statement, params);
  return rows as T[];
}

/** Generator's own tables (mg_*). */
export async function appQuery<T = RowDataPacket>(sql: string, params: Param[] = []): Promise<T[]> {
  pools.app ??= createPool(env().APP_DB_NAME);
  const [rows] = await pools.app.query<RowDataPacket[]>(sql, params);
  return rows as T[];
}

export type Transaction = {
  query<T = RowDataPacket>(sql: string, params?: Param[]): Promise<T[]>;
  execute(sql: string, params?: Param[]): Promise<ResultSetHeader>;
};

/** Runs `work` on one connection of the generator database; all of it is saved or none. */
export async function appTransaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
  pools.app ??= createPool(env().APP_DB_NAME);
  const connection = await pools.app.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work({
      async query<R = RowDataPacket>(sql: string, params: Param[] = []) {
        const [rows] = await connection.query<RowDataPacket[]>(sql, params);
        return rows as R[];
      },
      async execute(sql: string, params: Param[] = []) {
        const [header] = await connection.query<ResultSetHeader>(sql, params);
        return header;
      },
    });
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function appExecute(sql: string, params: Param[] = []): Promise<ResultSetHeader> {
  pools.app ??= createPool(env().APP_DB_NAME);
  const [result] = await pools.app.query<ResultSetHeader>(sql, params);
  return result;
}
