// Both queries use i as the alias for instruments.
export const tradableInstrument =
  "(btrim(i.type) <> '' AND i.type <> 'MONEDA')";
