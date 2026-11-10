export type ErrorCode =
  | "INVALID_REQUEST"
  | "ROUTE_NOT_FOUND"
  | "USER_NOT_FOUND"
  | "INSTRUMENT_NOT_FOUND"
  | "ORDER_NOT_FOUND"
  | "ORDER_NOT_CANCELLABLE"
  | "IDEMPOTENCY_CONFLICT"
  | "INSTRUMENT_NOT_TRADABLE"
  | "QUOTE_UNAVAILABLE"
  | "ACCOUNT_BUSY"
  | "DATABASE_UNAVAILABLE"
  | "SCHEMA_NOT_READY"
  | "DATA_INTEGRITY"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}

export function invalidRequest(message: string) {
  return new AppError("INVALID_REQUEST", message);
}
