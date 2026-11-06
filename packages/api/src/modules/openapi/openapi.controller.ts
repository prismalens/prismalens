// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller, Get, Header, Res } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
	EnvironmentVariables,
	getAppDataDir,
	resolvePort,
} from "@prismalens/config";
import type { Response } from "express";
import { Public } from "../../core/auth/public.decorator.js";
import { buildOpenApiSpec } from "./build-spec.js";

@Public()
@Controller()
export class OpenAPIController {
	private cachedSpec: object | null = null;

	constructor(private configService: ConfigService<EnvironmentVariables>) {}

	@Get("openapi.json")
	@Header("Content-Type", "application/json")
	async getOpenAPISpec() {
		if (this.cachedSpec) {
			return this.cachedSpec;
		}

		const spec = await buildOpenApiSpec([
			{
				url: `${this.configService.get("PRISMALENS_PROTOCOL")}://${this.configService.get("PRISMALENS_HOST")}:${resolvePort(process.env, getAppDataDir())}/api`,
				description: "Current server",
			},
			{ url: "/api", description: "Relative path" },
		]);

		this.cachedSpec = spec;
		return spec;
	}

	@Get("docs")
	@Header("Content-Type", "text/html")
	async getScalarDocs(@Res() res: Response) {
		const html = `
<!DOCTYPE html>
<html>
  <head>
    <title>PrismaLens API Reference</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>P</text></svg>" />
    <style>
      body { margin: 0; padding: 0; }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
    <script>
      Scalar.createApiReference('#app', {
        url: '/api/openapi.json',
        theme: 'purple',
        layout: 'modern',
        defaultHttpClient: {
          targetKey: 'javascript',
          clientKey: 'fetch',
        },
      })
    </script>
  </body>
</html>
    `;
		res.send(html);
	}
}
