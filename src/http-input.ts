import { invalidRequest } from "./errors.ts";

export const maxInt32 = 2_147_483_647;

export function positiveInt(value: unknown, field: string): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > maxInt32
  ) {
    throw invalidRequest(`${field} debe ser un entero entre 1 y ${maxInt32}.`);
  }
  return value;
}

export function parsePathId(value: string, field: string) {
  if (!/^\d{1,10}$/.test(value)) {
    throw invalidRequest(`${field} debe ser un id decimal válido.`);
  }
  return positiveInt(Number(value), field);
}
