import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { Router } from "express";

const resolve = createRequire(import.meta.url).resolve;
const specPath = fileURLToPath(
  new URL("../docs/openapi.json", import.meta.url),
);
const assets = ["swagger-ui-bundle.js", "swagger-ui.css"] as const;
const docsPage = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Cocos Challenge Backend | Swagger UI</title>
    <link rel="icon" href="data:,">
    <link rel="stylesheet" href="/docs/assets/swagger-ui.css">
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="/docs/assets/swagger-ui-bundle.js"></script>
    <script>
      SwaggerUIBundle({
        dom_id: "#swagger-ui",
        url: "/openapi.json",
        validatorUrl: null,
        tryItOutEnabled: false,
        supportedSubmitMethods: ["get", "post"],
      });
    </script>
  </body>
</html>`;

export function docsRouter() {
  const router = Router();
  router.get("/docs", (_request, response) => {
    response.type("html").send(docsPage);
  });
  router.get("/openapi.json", (_request, response) => {
    response.sendFile(specPath);
  });
  for (const asset of assets) {
    const assetPath = resolve(`swagger-ui-dist/${asset}`);
    router.get(`/docs/assets/${asset}`, (_request, response) => {
      response.sendFile(assetPath);
    });
  }
  return router;
}
