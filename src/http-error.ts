import type { ErrorRequestHandler } from "express";
import { AppError, type ErrorCode } from "./errors.ts";

const statusByCode = {
  INVALID_REQUEST: 400,
  USER_NOT_FOUND: 404,
  INSTRUMENT_NOT_FOUND: 404,
  ORDER_NOT_FOUND: 404,
  ORDER_NOT_CANCELLABLE: 409,
  INSTRUMENT_NOT_TRADABLE: 422,
  QUOTE_UNAVAILABLE: 422,
  ACCOUNT_BUSY: 503,
  DATA_INTEGRITY: 500,
} satisfies Record<ErrorCode, number>;

export const sendHttpError: ErrorRequestHandler = (
  error: unknown,
  _request,
  response,
  next,
) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  if (error instanceof AppError) {
    response
      .status(statusByCode[error.code])
      .json({ code: error.code, message: error.message });
    return;
  }

  if (
    error instanceof Error &&
    "status" in error &&
    typeof error.status === "number" &&
    error.status >= 400 &&
    error.status < 500
  ) {
    response.status(400).json({
      code: "INVALID_REQUEST",
      message: "La ruta o el cuerpo JSON no es válido.",
    });
    return;
  }

  console.error("Falló una solicitud HTTP.");
  response.status(500).json({
    code: "INTERNAL_ERROR",
    message: "No se pudo completar la solicitud.",
  });
};
