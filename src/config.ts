import { requireLocalDatabaseUrl } from "./database.ts";

export function loadConfig(env: NodeJS.ProcessEnv) {
  const rawPort = env.PORT ?? "3000";
  const port = Number(rawPort);
  if (!/^[1-9]\d*$/.test(rawPort) || port > 65_535) {
    throw new Error("PORT debe ser un entero entre 1 y 65535.");
  }

  return {
    port,
    databaseUrl: requireLocalDatabaseUrl(
      env.DATABASE_URL,
      "DATABASE_URL",
      "cocos_demo",
    ),
  };
}
