import { DatabaseError, type Pool } from "pg";
import { AppError } from "./errors.ts";

export async function checkReadiness(pool: Pool) {
  try {
    // Resolve the columns and read permissions without reading any rows.
    await pool.query(`
      SELECT u.id, i.id, i.ticker, i.name, i.type,
             o.id, o.userid, o.instrumentid, o.size, o.price, o.type, o.side,
             o.status, o.datetime,
             m.id, m.instrumentid, m.date, m.close, m.previousclose
      FROM public.users AS u
      CROSS JOIN public.instruments AS i
      CROSS JOIN public.orders AS o
      CROSS JOIN public.marketdata AS m
      LIMIT 0
    `);
  } catch (cause) {
    if (
      cause instanceof DatabaseError &&
      (cause.code === "42P01" || cause.code === "42703")
    ) {
      throw new AppError(
        "SCHEMA_NOT_READY",
        "El esquema de Cocos no está listo.",
        {
          cause,
        },
      );
    }

    throw new AppError(
      "DATABASE_UNAVAILABLE",
      "PostgreSQL no está disponible.",
      {
        cause,
      },
    );
  }
}
