---
"prismalens": patch
---

Fix the `openapi:generate` script and the live `/api/openapi.json` endpoint, both of which used `@orpc/zod`'s zod-v3 `ZodToJsonSchemaConverter` against this repo's zod v4 contracts. The converter silently failed to recognize the schemas, producing an empty JSON schema for every route input and an `OpenAPIGeneratorError` for any route with dynamic path params (#547). Import `ZodToJsonSchemaConverter` from `@orpc/zod/zod4` instead.
