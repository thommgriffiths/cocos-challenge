export type ErrorCode =
  | "INVALID_REQUEST"
  | "USER_NOT_FOUND"
  | "INSTRUMENT_NOT_FOUND"
  | "ORDER_NOT_FOUND"
  | "ORDER_NOT_CANCELLABLE"
  | "INSTRUMENT_NOT_TRADABLE"
  | "QUOTE_UNAVAILABLE"
  | "ACCOUNT_BUSY"
  | "DATA_INTEGRITY";

export class AppError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export function invalidRequest(message: string) {
  return new AppError("INVALID_REQUEST", message);
}
