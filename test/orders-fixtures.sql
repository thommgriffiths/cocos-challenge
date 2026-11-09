INSERT INTO users (accountNumber) VALUES ('BUYER'), ('SELLER'), ('EMPTY');

INSERT INTO instruments (ticker, name, type) VALUES
  ('ARS', 'Pesos', 'MONEDA'),
  ('ALFA', 'Alfa', 'ACCIONES'),
  ('NOQUOTE', 'Sin cotización', 'ACCIONES'),
  ('BADQUOTE', 'Último cierre inválido', 'ACCIONES'),
  ('NODATE', 'Fecha nula', 'ACCIONES'),
  ('INFDAY', 'Fecha infinita', 'ACCIONES');

INSERT INTO marketdata (instrumentId, date, close) VALUES
  (2, '2023-07-13', 10),
  (2, '2023-07-14', 29),
  (2, '2023-07-14', 29.999),
  (2, NULL, 99),
  (4, '2023-07-13', 10),
  (4, '2023-07-14', 'NaN'),
  (5, NULL, 10),
  (6, 'infinity', 10);

INSERT INTO orders (userId, instrumentId, size, price, side, type, status, datetime) VALUES
  (1, 1, 100, 2, 'CASH_IN', 'MARKET', 'FILLED', '2023-07-13 10:00:00'),
  (1, 2, 4, 5, 'BUY', 'LIMIT', 'FILLED', '2023-07-13 11:00:00'),
  (1, 1, 5, 99, 'CASH_OUT', 'MARKET', 'FILLED', '2023-07-13 12:00:00'),
  (2, 1, 95, 1, 'CASH_IN', 'MARKET', 'FILLED', '2023-07-13 10:00:00'),
  (3, 1, 20, 1, 'CASH_IN', 'MARKET', 'FILLED', '2023-07-13 10:00:00'),
  (3, 2, 4, 5, 'BUY', 'MARKET', 'FILLED', '2023-07-13 11:00:00');
