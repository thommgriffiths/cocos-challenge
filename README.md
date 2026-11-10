# Cocos Challenge Backend

API REST en Node.js, TypeScript, Express y PostgreSQL. Incluye portfolio, búsqueda de activos, envío y cancelación de órdenes. El [contrato de la API](docs/contract.md) reúne los formatos, los errores y las reglas contables.

## Arranque desde un clon

Usá Node.js `24.21.0`, npm `11.19.0` y Docker, o Apple Container en macOS. Con nvm, `nvm install` y `nvm use` seleccionan la versión de `.nvmrc`. Desde la raíz del clon, instalá las dependencias del lockfile y copiá la configuración local de ejemplo.

```sh
npm ci
cp .env.example .env
```

Creá un contenedor descartable con PostgreSQL 18.6, un usuario local y una base vacía. El puerto queda publicado en loopback.

```sh
docker run --rm -d --name cocos-challenge-postgres \
  -p 127.0.0.1:55432:5432 \
  -e POSTGRES_USER=cocos -e POSTGRES_PASSWORD=cocos_local -e POSTGRES_DB=cocos_demo \
  docker.io/library/postgres:18.6-bookworm
```

Con Apple Container, iniciá su servicio con `container system start` si hace falta y reemplazá `docker` por `container` en los comandos. Comprobá que PostgreSQL acepte conexiones. Repetí la comprobación si todavía está iniciando.

```sh
docker exec cocos-challenge-postgres pg_isready -h 127.0.0.1 -U cocos -d cocos_demo
```

Cargá el esquema y los datos de demo en una transacción, compilá TypeScript y arrancá la API.

```sh
npm run db:demo
npm run build
npm start
```

En otra terminal, `curl -fsS http://127.0.0.1:3000/health` devuelve `{"status":"ok"}` cuando PostgreSQL y el esquema están listos. La API escucha en `127.0.0.1`. `Ctrl+C` cierra el servidor y el pool.

## Documentación interactiva

Con la API en ejecución, abrí [Swagger UI](http://127.0.0.1:3000/docs) para consultar los cinco endpoints. La [especificación OpenAPI](http://127.0.0.1:3000/openapi.json) se puede importar en un cliente HTTP. Si cambiaste `PORT`, usá el mismo puerto para la documentación y la API.

Sobre una demo recién cargada, elegí **Try it out** y luego **Execute** en cada operación.

1. En `GET /instruments`, usá `ticker=pamp` y borrá el valor precargado de `name` para omitirlo. La respuesta `200` incluye PAMP (`id` 47).
2. En `POST /users/{userId}/orders`, usá `userId` `1` y elegí el ejemplo **LIMIT por monto** (compra PAMP por monto `100.00` a precio `30.00`). La respuesta `201` incluye `status: NEW` y `size: 3`. Copiá el `id` devuelto.
3. En `POST /users/{userId}/orders/{orderId}/cancel`, usá `userId` `1` y ese `id` como `orderId`. La respuesta `200` incluye `status: CANCELLED`.

Los `POST` modifican la demo. Si vas a seguir el recorrido `.http` de abajo con sus IDs de ejemplo, reiniciá la base de demo primero.

## Recorrido de evaluación

Abrí [examples/demo.http](examples/demo.http) con un cliente `.http` como REST Client de VS Code. Ejecutá los bloques de arriba abajo, una vez sobre una demo recién cargada. La cuenta de ejemplo tiene id `1`. Si cambiaste `PORT` en `.env`, actualizá `@baseUrl` en el archivo de ejemplos.

| Paso | Solicitud                              | Resultado esperado                                                                                                                                              |
| ---- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Salud                                  | `200` con `status` `ok`.                                                                                                                                        |
| 2    | Portfolio inicial                      | `200`, efectivo `753000.00`, disponible `627500.00`, patrimonio `889756.00` y 40 PAMP. El [contrato](docs/contract.md#portfolio) muestra la respuesta completa. |
| 3    | Buscar por ticker y nombre             | `200`, PAMP (`id` 47) como único resultado.                                                                                                                     |
| 4    | Comprar dos PAMP a mercado             | `201`, orden `12` en `FILLED` por `925.85` cada acción.                                                                                                         |
| 5    | Comprar PAMP por monto con límite      | `201`, orden `13` en `NEW` por 2 acciones a `1000.00`. Reserva `2000.00`.                                                                                       |
| 6    | Portfolio con la reserva               | `200`, efectivo `751148.30`, disponible `623648.30`, patrimonio `889756.00` y 42 PAMP.                                                                          |
| 7    | Vender una BMA sin tenencia suficiente | `201`, orden `14` en `REJECTED` con `INSUFFICIENT_SHARES`.                                                                                                      |
| 8    | Cancelar la compra pendiente           | `200`, orden `13` en `CANCELLED`. Libera `2000.00`.                                                                                                             |
| 9    | Portfolio final                        | `200`, efectivo `751148.30`, disponible `625648.30`, patrimonio `889756.00` y 42 PAMP.                                                                          |

Los `GET` se pueden repetir. Los `POST` de envío crean una fila, incluso cuando devuelven `REJECTED`, y la cancelación cambia el estado de la orden. `@limitOrderId` apunta al id `13`, que devuelve el paso 5 al seguir el recorrido en la demo inicial. Para cancelar otra orden pendiente, usá el id que devolvió su envío. Una búsqueda con `name=sin-coincidencias` devuelve `200` con `{"items":[],"limit":20,"offset":0}`.

Para repetir el recorrido desde cero, detené la API con `Ctrl+C` y ejecutá `docker stop cocos-challenge-postgres` (o `container stop cocos-challenge-postgres`). El contenedor de demo se elimina al detenerse porque se creó con `--rm`. Repetí los comandos de arranque de PostgreSQL de arriba, `npm run db:demo`, `npm run build` y `npm start`.

## Datos y verificación

`db/schema.sql` y `db/demo.sql` separan el esquema y las inserciones del `database.sql` provisto con el challenge. Conservan las definiciones, los valores y el orden de inserción. `db:demo` exige una base vacía. Un segundo intento sobre la base poblada devuelve un error y conserva los datos existentes.

`DATABASE_URL` configura la API, `DEMO_DATABASE_URL` configura la carga de la demo y `TEST_DATABASE_URL` configura las pruebas. Las tres URLs de `.env.example` apuntan al contenedor local. Las pruebas usan `postgres` como base de mantenimiento para crear una base `cocos_test_*` por ejecución de integración. Los scripts validan el destino antes de ejecutar DDL.

Con PostgreSQL disponible, ejecutá los controles del proyecto.

```sh
npm run check
```

`npm run check` verifica formato, lint y tipos, valida la especificación OpenAPI y sus ejemplos, compila y ejecuta los tests. GitHub Actions está configurado para ejecutar el mismo comando con un servicio PostgreSQL dedicado. Los tests pueden correr antes de `db:demo`. Cada suite de integración prepara el esquema y sus fixtures en una base temporal y la elimina al finalizar. `npm test` corre solo las pruebas.

`npm run test:unit` ejecuta las pruebas de configuración y de reglas puras sin levantar PostgreSQL.

En CI, `npm run test:smoke` también arranca el servidor compilado, comprueba el `503` sin esquema, carga la demo y verifica el `200` de salud y del portfolio. Para reproducirlo localmente, ejecutalo después de `npm run build` con `DEMO_DATABASE_URL` apuntando a una base de demo descartable y vacía y con `PORT` libre. El smoke deja la demo cargada y cierra el servidor.

## Decisiones y alcance

- PostgreSQL concentra los movimientos. El envío y la cancelación toman el mismo bloqueo por cuenta. El portfolio lee caja, posiciones, cotizaciones y costo promedio en un único snapshot.
- Los importes se calculan en centavos exactos y salen como cadenas decimales. El costo promedio y los porcentajes usan aritmética decimal. El contrato detalla el redondeo, las reservas y el tratamiento de posiciones históricas negativas.
- La aplicación está pensada para una evaluación local con datos históricos. Las órdenes `MARKET` usan el último cierre. Las `LIMIT` quedan pendientes hasta su cancelación. Autenticación, carga de transferencias y matching quedan fuera del alcance.
