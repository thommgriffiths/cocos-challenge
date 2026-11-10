import assert from "node:assert/strict";
import { Ajv2020 } from "ajv/dist/2020.js";
import openapi from "../docs/openapi.json" with { type: "json" };

const documentId = "https://cocos.invalid/openapi.json";
const ajv = new Ajv2020({ formats: { int32: true } });
// Preserve the OpenAPI pointers. Only the selected response schema validates data.
ajv.addKeyword("paths");
ajv.addKeyword("components");
ajv.addSchema(
  { paths: openapi.paths, components: openapi.components },
  documentId,
);

type Method = "get" | "post";
type ResponseDeclaration = { $ref: string } | { content: object };
type PathItem = Partial<
  Record<Method, { responses: Record<string, ResponseDeclaration> }>
>;

export function assertDocumentedResponse(
  method: Method,
  path: keyof typeof openapi.paths,
  { status, body }: { status: number; body: unknown },
) {
  const operation = `${method.toUpperCase()} ${path} ${status}`;
  const item: PathItem = openapi.paths[path];
  const response = item[method]?.responses[status];
  assert.ok(response, `Missing documented response for ${operation}`);

  const escaped = path.replaceAll("~", "~0").replaceAll("/", "~1");
  const pointer =
    "$ref" in response
      ? response.$ref
      : `#/paths/${escaped}/${method}/responses/${status}`;
  const validate = ajv.getSchema(
    `${documentId}${pointer}/content/application~1json/schema`,
  );
  assert.ok(validate, `Missing documented response schema for ${operation}`);
  assert.ok(validate(body), `${operation}: ${ajv.errorsText(validate.errors)}`);
}
