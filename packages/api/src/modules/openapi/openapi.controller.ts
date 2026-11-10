// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller, Get, Header } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
	EnvironmentVariables,
	getAppDataDir,
	resolvePort,
} from "@prismalens/config";
import { buildOpenApiSpec } from "./build-spec.js";

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
}
