// Queries using this predicate alias instruments as i.
export const tradableInstrument =
  "(btrim(i.type) <> '' AND i.type <> 'MONEDA')";
