# Contrato de la API y reglas contables

La API expone el portfolio de una cuenta, la búsqueda de instrumentos y el envío de órdenes. También permite cancelar una orden pendiente para liberar sus reservas. La aplicación corre en Node.js con TypeScript estricto, Express y PostgreSQL. Usamos `pg` y SQL parametrizado para hacer explícitas las agregaciones, el manejo de tipos y las transacciones. HTTP valida y traduce solicitudes y respuestas. La lógica contable puede probarse por separado.

## Esquema de referencia

El esquema local toma como referencia el SQL provisto con la consigna. La inspección de Neon en solo lectura confirmó que las cuatro tablas coinciden con el seed en columnas, tipos, precisión, nulabilidad, defaults y claves. En el esquema de referencia, cada tabla tiene un índice único de clave primaria en `id`. El esquema local agrega [dos índices para las consultas de cuenta y cotizaciones](indexes.md). Los ejemplos corresponden a una base local recién inicializada con los datos de demostración.

| Tabla | Columnas relevantes del seed |
| --- | --- |
| `users` | `id` como clave primaria y `accountnumber` como dato de la cuenta. Las rutas usan `id`. |
| `instruments` | `id`, `ticker`, `name`, `type`. El efectivo corresponde a `ticker = 'ARS'` y `type = 'MONEDA'`. |
| `orders` | `id`, `instrumentid`, `userid`, `size` entero, `price` como `NUMERIC(10,2)`, `side`, `type`, `status` y `datetime` como `TIMESTAMP` sin zona. |
| `marketdata` | `id`, `instrumentid`, `date` como `DATE`, `close` y `previousclose` como `NUMERIC(10,2)`. La fecha es `date`, aunque la consigna la describe como `datetime`. |

PostgreSQL almacena estos identificadores sin comillas en minúsculas. `orders` tiene claves foráneas hacia usuarios e instrumentos y `marketdata` hacia instrumentos. Las columnas distintas de `id` admiten nulos. Los cuatro `id` tienen defaults de secuencia. La carga conserva el orden de inserción en una base vacía porque las referencias del seed usan esos ids.

La comparación de datos se limitó a los 11 movimientos de la cuenta de demo y a siete instrumentos, incluidos los que determinan los ejemplos de portfolio y el retorno de BBAR. La muestra coincidió con el seed. `PGR` e `IRCP` carecen de cotización y `ARS` se contabiliza como efectivo.

## Convenciones HTTP

- Los ids de usuario, instrumento y orden están entre `1` y `2147483647`. Los ids en rutas se escriben en decimal y los del cuerpo JSON son números enteros.
- Las solicitudes con cuerpo usan JSON. `size` es un número entero entre `1` y `2147483647`. `price` y `amount`, cuando aplican, son cadenas decimales positivas con hasta dos decimales, sin signo, espacios ni notación científica. El precio unitario admite hasta ocho dígitos enteros y el monto hasta dieciocho. Los importes de salida son cadenas con dos decimales, con signo si corresponde.
- Las cantidades agregadas son números JSON enteros. Si una cantidad abierta excede el rango de enteros seguros de JavaScript, devolvemos `500` con `DATA_INTEGRITY` antes de serializarla. La API no redondea una cantidad de acciones.
- Los errores comparten el formato `{"code":"INVALID_REQUEST","message":"Enviá exactamente uno entre size y amount."}`. `code` es estable para clientes. El mensaje explica el problema sin incluir datos internos del servidor.

| HTTP | Código | Condición |
| --- | --- | --- |
| `400` | `INVALID_REQUEST` | Parámetros o cuerpo inválidos, incluido un monto que produce cero acciones o excede el rango de `size`. |
| `404` | `ROUTE_NOT_FOUND` | La ruta o el método solicitado no corresponde a una operación de la API. |
| `404` | `USER_NOT_FOUND`, `INSTRUMENT_NOT_FOUND`, `ORDER_NOT_FOUND` | El recurso no existe. Una orden que pertenece a otra cuenta también devuelve `ORDER_NOT_FOUND`. |
| `409` | `ORDER_NOT_CANCELLABLE` | La orden pertenece a la cuenta y su estado difiere de `NEW`. |
| `422` | `INSTRUMENT_NOT_TRADABLE`, `QUOTE_UNAVAILABLE` | El instrumento existe y queda fuera del catálogo, o una orden `MARKET` carece de cierre válido. |
| `503` | `ACCOUNT_BUSY` | Se agotó la espera por el bloqueo de cuenta y se revirtió la transacción. |
| `503` | `SCHEMA_NOT_READY`, `DATABASE_UNAVAILABLE` | La comprobación de disponibilidad detectó un esquema incompleto o no pudo consultar PostgreSQL. |
| `500` | `DATA_INTEGRITY`, `INTERNAL_ERROR` | Los datos impiden un cálculo confiable o se produjo un fallo técnico. |

Las respuestas `5xx` incluyen `X-Request-Id` para correlacionarlas con el registro del servidor. El registro incluye el método, el estado HTTP, el código de error y el SQLSTATE cuando PostgreSQL lo informa. Los cuerpos, parámetros y credenciales quedan fuera del registro.

`GET /health` devuelve `200` con `{"status":"ok"}` cuando puede consultar las tablas y columnas necesarias del esquema público. La comprobación resuelve el esquema sin leer filas. Una base conectada y vacía devuelve `503` con `SCHEMA_NOT_READY` hasta que se cargue el esquema.

## Enviar una orden

`POST /users/:userId/orders` recibe `instrumentId`, `side` (`BUY` o `SELL`), `type` (`MARKET` o `LIMIT`) y exactamente uno entre `size` y `amount`. El catálogo de órdenes y búsqueda incluye instrumentos con tipo informado distinto de `MONEDA`. La cotización no determina pertenencia al catálogo.

`MARKET` toma el `close` de la última cotización y cualquier campo `price` de la solicitud queda sin efecto. `LIMIT` exige `price` y usa ese valor, aunque el instrumento carezca de cotización. La API guarda el precio unitario aplicado. La última cotización se elige por `date DESC NULLS LAST, id DESC`. Exigimos una fecha finita y un `close` finito y positivo en esa fila. Si la fecha o el cierre de ese registro son inválidos, el precio queda indisponible. Una cotización anterior no sustituye ese dato.

Con `amount`, la cantidad es el cociente entero entre el monto y el precio, expresados en centavos. Para `BUY`, el monto es un tope de gasto. Para `SELL`, es un tope de valor bruto al precio aplicable. La validación compara el importe efectivo de la compra o la cantidad efectiva de la venta con los recursos disponibles. Por ejemplo, con caja disponible `95.00`, monto `100.00` y precio `30.00`, se acepta una compra de 3 acciones por `90.00`. El remanente no se usa y la orden se rechaza completa si los recursos no alcanzan.

| Resultado | HTTP | Persistencia |
| --- | --- | --- |
| `MARKET` con recursos suficientes | `201` | `FILLED` y efecto inmediato en caja y tenencias. |
| `LIMIT` con recursos suficientes | `201` | `NEW` y reserva. La orden queda pendiente incluso si su precio cruza el último cierre. |
| Orden válida con recursos insuficientes | `201` | `REJECTED` sin efecto contable. La respuesta incluye `rejectionReason` con `INSUFFICIENT_CASH` o `INSUFFICIENT_SHARES`. |
| Entrada inválida, recurso inexistente o precio requerido indisponible | `400`, `404` o `422` | Sin nueva fila. |

Ejemplo de `POST /users/1/orders` sobre la demo inicial.

```json
{"instrumentId":47,"side":"BUY","type":"MARKET","size":2}
```

Respuesta `201`.

```json
{"id":12,"userId":1,"instrumentId":47,"side":"BUY","type":"MARKET","size":2,"price":"925.85","status":"FILLED"}
```

Una compra `LIMIT` por monto se envía como `{"instrumentId":47,"side":"BUY","type":"LIMIT","amount":"100.00","price":"30.00"}`. En la demo inicial crea una orden `NEW` de 3 acciones y reserva `90.00`.

Una venta `MARKET` de 1 BMA (`instrumentId` 31) desde la misma cuenta inicial devuelve `201` y queda `REJECTED`, porque la posición histórica es −10.

```json
{"id":12,"userId":1,"instrumentId":31,"side":"SELL","type":"MARKET","size":1,"price":"1502.80","status":"REJECTED","rejectionReason":"INSUFFICIENT_SHARES"}
```

Los ejemplos de escritura son independientes y parten del mismo estado. Un segundo `POST` de envío crea otra orden. Ante una respuesta perdida, el cliente puede desconocer si el primer envío se guardó.

## Cancelar una orden

`POST /users/:userId/orders/:orderId/cancel` cancela solo una orden `NEW` que pertenezca a esa cuenta. El cambio a `CANCELLED` libera la reserva una vez y conserva la fecha de creación. El endpoint no requiere cuerpo. Sobre la demo inicial, `POST /users/1/orders/5/cancel` libera `35500.00` y devuelve `200`.

```json
{"id":5,"status":"CANCELLED"}
```

Una segunda cancelación devuelve `409`. La orden sigue cancelada y el disponible no cambia.

## Portfolio

`GET /users/:userId/portfolio` devuelve `200` con efectivo ejecutado, pesos disponibles para operar, valor total y posiciones abiertas. Todas las cifras monetarias están en ARS. Para un usuario existente sin movimientos, los importes son `"0.00"` y `positions` es `[]`. Una cuenta inexistente devuelve `404`.

| Movimiento | Efectivo ejecutado | Acciones ejecutadas | Reserva |
| --- | --- | --- | --- |
| `FILLED CASH_IN` de ARS | `+size` | — | — |
| `FILLED CASH_OUT` de ARS | `−size` | — | — |
| `FILLED BUY` | `−size × price` | `+size` | — |
| `FILLED SELL` | `+size × price` | `−size` | — |
| `NEW BUY` | — | — | `size × price` pesos |
| `NEW SELL` | — | — | `size` acciones |
| `CANCELLED` o `REJECTED` | — | — | — |

La caja y las tenencias se derivan de `orders`. Una `LIMIT` histórica en `FILLED` cuenta igual que cualquier otra ejecución. `availableCash` es efectivo ejecutado menos pesos reservados. Para validar una venta, restamos las acciones reservadas a las ejecutadas de ese instrumento. Una venta `NEW` no financia compras. Los valores de disponibilidad conservan el signo cuando el historial produce un saldo negativo.

`totalValue` suma efectivo ejecutado y el valor firmado de las posiciones abiertas. `marketValue` es `quantity × close`. Las reservas no reducen el patrimonio. Una posición cerrada se omite. Si una posición abierta carece de cierre válido, conserva su cantidad y devuelve `null` en valor y rendimientos. En ese caso `totalValue` también es `null`. El efectivo y el disponible siguen calculándose.

`positionReturnPct` mide el rendimiento no realizado de la posición abierta. Para una posición positiva es `(close − costoPromedioUnitario) × 100 / costoPromedioUnitario`. Una compra promedia el costo remanente con el de las nuevas acciones. Una venta parcial conserva el costo promedio unitario. Un cierre descarta el costo. Si una compra supera una posición negativa, el excedente abre la nueva posición positiva al precio de esa compra. Se recorren las ejecuciones por `datetime ASC, id ASC`.

La posición negativa de BMA del seed se informa con cantidad y valor firmados, `historicalNegative: true` y `positionReturnPct: null`. Las órdenes nuevas siguen validando disponibilidad y una compra con recursos suficientes puede reducir ese déficit. El campo `historicalNegative` indica que la cantidad actual es negativa.

`dailyReturnPct` usa `(close − previousClose) × 100 / previousClose` de la misma cotización, incluso para una posición negativa. Devuelve `null` si alguno de los dos precios no es finito y positivo. En el seed, `previousclose` de BBAR del 14 de julio queda en `1047.17` al importarse. El cálculo usa ese valor almacenado. La selección y validación de precios para estos cálculos prescinden de `open`, `high` y `low`.

Los importes y las agregaciones usan centavos enteros o `numeric` sin convertir a coma flotante binaria. Para costo promedio y porcentajes, el cálculo decimal usa 40 dígitos significativos con redondeo half-up. El porcentaje calculado se serializa como cadena con dos decimales y redondeo half-up. Por ejemplo, `-1.005` se publica como `"-1.01"`. Un resultado redondeado a cero se representa como `"0.00"`.

Ejemplo de `GET /users/1/portfolio` sobre la demo inicial, con posiciones ordenadas por ticker e id del instrumento y tickers nulos al final.

```json
{
  "userId": 1,
  "cash": "753000.00",
  "availableCash": "627500.00",
  "totalValue": "889756.00",
  "positions": [
    {"instrumentId":31,"ticker":"BMA","quantity":-10,"marketValue":"-15028.00","positionReturnPct":null,"dailyReturnPct":"-1.15","historicalNegative":true},
    {"instrumentId":54,"ticker":"METR","quantity":500,"marketValue":"114750.00","positionReturnPct":"-8.20","dailyReturnPct":"-1.08","historicalNegative":false},
    {"instrumentId":47,"ticker":"PAMP","quantity":40,"marketValue":"37034.00","positionReturnPct":"-0.45","dailyReturnPct":"0.44","historicalNegative":false}
  ]
}
```

### Integridad del historial

- Un `FILLED` requiere `size` positivo, instrumento identificado y un `side` entre `CASH_IN`, `CASH_OUT`, `BUY` y `SELL`. Una transferencia requiere el instrumento ARS, usa `size` como importe y prescinde de `price`. Una compra o venta requiere un instrumento del catálogo y un precio finito y positivo. El portfolio requiere además un `datetime` finito para ordenar las ejecuciones de compra y venta.
- Una `NEW` requiere `type = LIMIT` y un `side` que sea `BUY` o `SELL`, además de un instrumento del catálogo, `size` positivo y precio finito y positivo. Un `CANCELLED` o `REJECTED` no interviene en los cálculos. Un estado nulo o desconocido de una orden de la cuenta produce `DATA_INTEGRITY`, igual que un campo requerido inválido en un movimiento que se está contabilizando.
- Una fila sin usuario asignado no se atribuye a ninguna cuenta. Los datos históricos se conservan. Una anomalía que impida calcular caja, cantidad o costo se informa como error, mientras la posición negativa conocida se representa según las reglas anteriores.

## Buscar instrumentos

`GET /instruments` requiere al menos un filtro entre `ticker` y `name`. Cada filtro acepta entre 1 y 100 caracteres después de quitar espacios al comienzo y al final. Un filtro enviado vacío o repetido devuelve `400`. La coincidencia es parcial, literal y sin distinguir mayúsculas. Los acentos se conservan y los comodines se escapan. Si llegan ambos filtros, se aplican con `AND`.

`limit` admite enteros de `1` a `100` y su valor predeterminado es `20`. `offset` admite enteros de `0` a `100000` y su valor predeterminado es `0`. El orden es por ticker ascendente, con nulos al final, e id ascendente como desempate. Una página vacía devuelve `200` con `items: []`.

Ejemplo de `GET /instruments?ticker=pamp&name=holding&limit=20&offset=0`.

```json
{"items":[{"id":47,"ticker":"PAMP","name":"Pampa Holding S.A.","type":"ACCIONES"}],"limit":20,"offset":0}
```

## Consistencia y verificación

- Enviar y cancelar usan una transacción `READ COMMITTED` en una sola conexión. El bloqueo de la fila de `users` se adquiere primero. La lectura de disponibilidad se hace en una sentencia posterior y la escritura se confirma antes de responder. Las altas toman el reloj de la base bajo el bloqueo y guardan `datetime` en UTC. Si el esquema usa `TIMESTAMP` sin zona, la convención UTC aplica a las altas y el historial conserva sus valores originales. Un fallo técnico revierte la transacción. La espera por el bloqueo se acota a 5 segundos.
- El portfolio usa un único snapshot. Si necesita más de una consulta, ejecuta una transacción `REPEATABLE READ READ ONLY`. Reutiliza las reglas de recursos de órdenes, obtiene las cotizaciones en conjunto y recorre en lotes el historial necesario para costo promedio. Los ids y valores monetarios se validan al cruzar la frontera entre SQL y JSON.
- La prueba funcional de envío usa HTTP y PostgreSQL local. Verifica la fila persistida y los efectos contables, incluidos `REJECTED`, reserva `NEW`, rollback y dos solicitudes incompatibles superpuestas. Un fixture con `CASH_IN` de `size = 100` y `price = 2` aporta `100.00`. Dos compras de 10 a `100.00` y `200.00` seguidas de una venta de 10 dejan costo promedio `150.00` y retorno `20.00` a un cierre de `180.00`.
- La demo se reproduce desde una base vacía y preserva los datos del seed que determinan los ejemplos. Las pruebas usan una base local separada. El servicio cubre un catálogo histórico y órdenes locales. La autenticación, la creación de transferencias, el matching y la ejecución posterior de órdenes pendientes quedan fuera del alcance.
