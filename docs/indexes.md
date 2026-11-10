# Índices de cuenta y cotizaciones

| Índice                                | Consulta que acompaña                                                                                                                                                                                    |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `orders_userid_datetime_id_idx`       | Acota la lectura de [recursos](../src/account-resources.ts) por `userid`. Para el [costo promedio](../src/portfolio/cost.ts), las columnas siguientes coinciden con el orden cronológico `datetime, id`. |
| `marketdata_instrumentid_date_id_idx` | Acota las [cotizaciones](../src/quotes.ts) a los instrumentos solicitados. El orden `date DESC NULLS LAST, id DESC` coincide con la selección del último cierre, incluido su desempate.                  |

El [esquema local](../db/schema.sql) crea ambos índices al inicializar la demo y las bases de prueba. Para conservar una demo local anterior a este cambio, detené la API y ejecutá las dos sentencias `CREATE INDEX` del esquema en una misma transacción en esa base. El planificador decide cuándo usar los índices según el tamaño y la selectividad. En la demo chica puede elegir un recorrido secuencial. Los índices consumen espacio y agregan trabajo a las escrituras. [Índices multicolumna](https://www.postgresql.org/docs/18/indexes-multicolumn.html) · [Orden de los índices](https://www.postgresql.org/docs/18/indexes-ordering.html)

## Medición

Ejecuté `EXPLAIN (ANALYZE, BUFFERS, TIMING OFF)` en PostgreSQL 18.6 sobre las consultas de la aplicación, con 200.000 órdenes de 1.000 cuentas y 200.000 cotizaciones de 100 instrumentos. Medí una cuenta y tres instrumentos. Los bloques son la suma de `shared hit` y `shared read` del nodo raíz de cada plan.

| Consulta                                | Bloques sin los índices | Bloques con los índices |
| --------------------------------------- | ----------------------: | ----------------------: |
| Recursos de una cuenta                  |                   1.879 |                     204 |
| Historial ejecutado para costo promedio |                   1.870 |                     203 |
| Último cierre de tres instrumentos      |                   1.275 |                      65 |

En esa distribución, los planes pasaron de recorrer las tablas completas a usar los índices para acotar los candidatos. El costo y las cotizaciones pueden requerir un ordenamiento adicional si PostgreSQL usa un bitmap. Las cifras describen la carga sintética. [Cómo leer `EXPLAIN`](https://www.postgresql.org/docs/18/using-explain.html)

## Reproducir el efecto

Abrí una sesión `psql` en la demo local con el esquema inicializado. Las tablas temporales copian la estructura y se cargan con datos sintéticos. Ejecutá los bloques en la misma sesión. `ROLLBACK` elimina las tablas temporales y sus índices.

```sql
BEGIN;
CREATE TEMP TABLE bench_orders (LIKE public.orders) ON COMMIT DROP;
CREATE TEMP TABLE bench_marketdata (LIKE public.marketdata) ON COMMIT DROP;

INSERT INTO bench_orders (id, userid, instrumentid, size, price, type, side, status, datetime)
SELECT (u - 1) * 200 + n, u, 1 + n % 100, 2, 10, 'MARKET', 'BUY', 'FILLED',
       TIMESTAMP '2024-01-01' + n * INTERVAL '1 minute'
FROM generate_series(1, 1000) AS u CROSS JOIN generate_series(1, 200) AS n;

INSERT INTO bench_marketdata (id, instrumentid, date, close, previousclose)
SELECT (i - 1) * 2000 + n, i, DATE '2020-01-01' + n, 10, 9
FROM generate_series(1, 100) AS i CROSS JOIN generate_series(1, 2000) AS n;

ANALYZE bench_orders;
ANALYZE bench_marketdata;
```

Medí los accesos que representan el filtro por cuenta, el historial ordenado y la selección del último cierre. En estas tablas temporales, mirá los bloques `local` en el nodo raíz.

```sql
EXPLAIN (ANALYZE, BUFFERS, TIMING OFF)
SELECT instrumentid, status, size, price FROM bench_orders
WHERE userid = 1
  AND status IS DISTINCT FROM 'CANCELLED' AND status IS DISTINCT FROM 'REJECTED';

EXPLAIN (ANALYZE, BUFFERS, TIMING OFF)
SELECT instrumentid, side, size, price FROM bench_orders
WHERE userid = 1 AND instrumentid IN (1, 2, 3)
  AND status = 'FILLED' AND side IN ('BUY', 'SELL')
ORDER BY datetime ASC, id ASC;

EXPLAIN (ANALYZE, BUFFERS, TIMING OFF)
SELECT DISTINCT ON (instrumentid) instrumentid, date, close, previousclose
FROM bench_marketdata WHERE instrumentid IN (1, 2, 3)
ORDER BY instrumentid, date DESC NULLS LAST, id DESC;
```

Creá los índices de comparación, repetí los tres `EXPLAIN` y luego ejecutá `ROLLBACK`.

```sql
CREATE INDEX ON bench_orders (userid, datetime, id);
CREATE INDEX ON bench_marketdata (instrumentid, date DESC NULLS LAST, id DESC);
```
