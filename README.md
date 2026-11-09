# Cocos Challenge Backend

API REST en Node.js, TypeScript, Express y PostgreSQL. Están disponibles el portfolio, el envío y la cancelación de órdenes. El [contrato](docs/contract.md) describe sus formatos y reglas contables. `GET /health` comprueba el acceso a PostgreSQL.

## Arranque local

Usá Node.js `24.21.0`, npm `11.19.0` y Docker. La versión de Node está en `.nvmrc`. Con nvm, `nvm install` y `nvm use` seleccionan esa versión. `npm ci` instala las dependencias del lockfile.

```sh
npm ci
cp .env.example .env
```

Creá un contenedor descartable con PostgreSQL 18.6, una cuenta local de desarrollo y una base vacía. El puerto se publica solo en loopback.

```sh
docker run --rm -d --name cocos-challenge-postgres \
  -p 127.0.0.1:55432:5432 \
  -e POSTGRES_USER=cocos -e POSTGRES_PASSWORD=cocos_local -e POSTGRES_DB=cocos_demo \
  docker.io/library/postgres:18.6-bookworm
docker exec cocos-challenge-postgres pg_isready -h 127.0.0.1 -U cocos -d cocos_demo
```

Si usás Apple Container en macOS, el mismo flujo funciona reemplazando `docker` por `container`, con su servicio iniciado. Cuando `pg_isready` indique que PostgreSQL acepta conexiones, prepará la demo, compilá y arrancá la API.

```sh
npm run db:demo
npm run build
npm start
```

En otra terminal, `curl -fsS http://127.0.0.1:3000/health` devuelve `{"status":"ok"}` cuando la API puede consultar PostgreSQL. La API escucha en `127.0.0.1`. `Ctrl+C` cierra el servidor y el pool.

`DATABASE_URL` configura la API, `DEMO_DATABASE_URL` configura la carga de la demo y `TEST_DATABASE_URL` configura las pruebas. Las URLs de `.env.example` apuntan al contenedor local. La carga de demo exige la base vacía `cocos_demo`. Las pruebas usan `postgres` como base de mantenimiento para crear y eliminar una base propia `cocos_test_*` por ejecución de integración. Los destinos de ambos scripts se validan antes de ejecutar DDL.

## Datos y verificación

`db/schema.sql` y `db/demo.sql` separan el esquema y las inserciones del `database.sql` provisto con el challenge. Conservan las definiciones, valores y el orden de inserción. El comando `db:demo` aplica ambos archivos en una transacción sobre una base vacía. Un segundo intento sobre la base poblada devuelve un error y conserva los datos existentes. `npm start` solo arranca el servicio.

```sh
npm run check
```

El comando verifica formato, lint y tipos, compila y ejecuta los tests. GitHub Actions ejecuta el mismo comando con un servicio PostgreSQL dedicado. Los tests pueden correr con el contenedor recién iniciado, sin ejecutar `db:demo`. Cada base de test recibe el esquema y `test/fixtures.sql`, y se elimina al finalizar. `npm run format` aplica el formato y `npm test` corre solo las pruebas.

Las pruebas de órdenes cargan su propio historial, hacen solicitudes HTTP y verifican las filas persistidas. También fuerzan el solapamiento de solicitudes con un bloqueo real en PostgreSQL y simulan una falla al confirmar la transacción.

Para volver a una demo vacía, detené la API y ejecutá `docker stop cocos-challenge-postgres` (o `container stop cocos-challenge-postgres`). El contenedor fue creado con `--rm` y sus datos son descartables. Repetí el comando de arranque de PostgreSQL y luego `npm run db:demo`.
