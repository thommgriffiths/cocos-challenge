import express from "express";
import type { Pool } from "pg";
import { invalidRequest } from "../errors.ts";
import { searchInstruments } from "./search.ts";

function scalarParam(params: URLSearchParams, key: string) {
  const values = params.getAll(key);
  if (values.length > 1) {
    throw invalidRequest(`${key} debe enviarse una sola vez.`);
  }
  return values[0] ?? null;
}

function filterParam(params: URLSearchParams, key: string) {
  const value = scalarParam(params, key);
  if (value === null) return null;

  const term = value.trim();
  if (!term || [...term].length > 100 || term.includes("\0")) {
    throw invalidRequest(
      `${key} debe contener entre 1 y 100 caracteres válidos.`,
    );
  }
  return term;
}

function integerParam(
  params: URLSearchParams,
  key: string,
  min: number,
  max: number,
  defaultValue: number,
) {
  const value = scalarParam(params, key);
  if (value === null) return defaultValue;

  const parsed = Number(value);
  if (!/^\d+$/.test(value) || parsed < min || parsed > max) {
    throw invalidRequest(`${key} debe ser un entero entre ${min} y ${max}.`);
  }
  return parsed;
}

export function instrumentsRouter(pool: Pool) {
  const router = express.Router();

  router.get("/instruments", async (request, response) => {
    const separator = request.originalUrl.indexOf("?");
    const params = new URLSearchParams(
      separator === -1 ? "" : request.originalUrl.slice(separator),
    );
    const ticker = filterParam(params, "ticker");
    const name = filterParam(params, "name");
    if (ticker === null && name === null) {
      throw invalidRequest("Enviá al menos uno de los filtros ticker o name.");
    }

    const limit = integerParam(params, "limit", 1, 100, 20);
    const offset = integerParam(params, "offset", 0, 100_000, 0);
    response.json(
      await searchInstruments(pool, { ticker, name, limit, offset }),
    );
  });

  return router;
}
