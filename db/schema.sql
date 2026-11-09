
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255),
  accountNumber VARCHAR(20)
);

CREATE TABLE instruments (
  id SERIAL PRIMARY KEY,
  ticker VARCHAR(10),
  name VARCHAR(255),
  type VARCHAR(10)
);

CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  instrumentId INT,
  userId INT,
  size INT,
  price NUMERIC(10, 2),
  type VARCHAR(10),
  side VARCHAR(10),
  status VARCHAR(20),
  datetime TIMESTAMP,
  FOREIGN KEY (instrumentId) REFERENCES instruments(id),
  FOREIGN KEY (userId) REFERENCES users(id)
);

CREATE TABLE marketdata (
  id SERIAL PRIMARY KEY,
  instrumentId INT,
  high NUMERIC(10, 2),
  low NUMERIC(10, 2),
  open NUMERIC(10, 2),
  close NUMERIC(10, 2),
  previousClose NUMERIC(10, 2),
  date DATE,
  FOREIGN KEY (instrumentId) REFERENCES instruments(id)
);
