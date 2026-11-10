import type { Client, PoolConfig } from "pg";

export const demoDatabaseName = "cocos_demo";
const localDatabaseUser = "cocos";

export function requireLocalDatabaseUrl(
  value: string | undefined,
  variable: string,
  database: string,
): URL {
  if (!value) {
    throw new Error(`Configurá ${variable} según el README.`);
  }

  const url = URL.parse(value);
  if (
    !url ||
    url.protocol !== "postgresql:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    url.port === "0" ||
    url.username !== localDatabaseUser ||
    !url.password ||
    url.pathname !== `/${database}` ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      `${variable} debe apuntar a la base local ${database} con el usuario ${localDatabaseUser} y puerto explícito.`,
    );
  }

  return url;
}

export function databaseConfig(url: URL): PoolConfig {
  return {
    host: url.hostname,
    port: Number(url.port),
    user: url.username,
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
    connectionTimeoutMillis: 3_000,
    statement_timeout: 10_000,
    options: "-c search_path=public",
    ssl: false,
  };
}

export async function assertDatabase(client: Client, database: string) {
  const result = await client.query<{ matches: boolean }>(
    "SELECT current_database() = $1 AND current_user = $2 AS matches",
    [database, localDatabaseUser],
  );
  if (!result.rows[0]?.matches) {
    throw new Error("PostgreSQL respondió con una base o usuario inesperados.");
  }
}
