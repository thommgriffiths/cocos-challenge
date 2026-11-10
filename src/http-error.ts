import { randomUUID } from "node:crypto";
import type { ErrorRequestHandler } from "express";
import { DatabaseError } from "pg";
import { AppError, type ErrorCode, invalidRequest } from "./errors.ts";

const statusByCode = {
  INVALID_REQUEST: 400,
  ROUTE_NOT_FOUND: 404,
  USER_NOT_FOUND: 404,
  INSTRUMENT_NOT_FOUND: 404,
  ORDER_NOT_FOUND: 404,
  ORDER_NOT_CANCELLABLE: 409,
  INSTRUMENT_NOT_TRADABLE: 422,
  QUOTE_UNAVAILABLE: 422,
  ACCOUNT_BUSY: 503,
  DATABASE_UNAVAILABLE: 503,
  SCHEMA_NOT_READY: 503,
  DATA_INTEGRITY: 500,
  INTERNAL_ERROR: 500,
} satisfies Record<ErrorCode, number>;

function toHttpError(error: unknown) {
  if (error instanceof AppError) return error;
  if (
    error instanceof Error &&
    "status" in error &&
    typeof error.status === "number" &&
    error.status >= 400 &&
    error.status < 500
  ) {
    return invalidRequest("La ruta o el cuerpo JSON no es válido.");
  }

  return new AppError("INTERNAL_ERROR", "No se pudo completar la solicitud.", {
    cause: error,
  });
}

export const sendHttpError: ErrorRequestHandler = (
  error: unknown,
  request,
  response,
  next,
) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  const { code, message, cause } = toHttpError(error);
  const status = statusByCode[code];
  if (status >= 500) {
    const requestId = randomUUID();
    response.set("X-Request-Id", requestId);
    console.error(
      JSON.stringify({
        requestId,
        method: request.method,
        status,
        code,
        sqlstate: cause instanceof DatabaseError ? cause.code : undefined,
      }),
    );
  }

  response.status(status).json({ code, message });
};
