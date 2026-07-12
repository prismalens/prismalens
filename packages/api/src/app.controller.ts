// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller, Get } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EnvironmentVariables } from "@prismalens/config";
import { Public } from "./core/auth/public.decorator.js";

@Public()
@Controller()
export class AppController {
	constructor(readonly _configService: ConfigService<EnvironmentVariables>) {}

	@Get()
	root(): {
		name: string;
		version: string;
		edition: string;
		docs: string;
	} {
		return {
			name: "PrismaLens API",
			version: "0.1.0",
			edition: "COMMUNITY", //TODO: Dynamically set based on license
			docs: "/api",
		};
	}
}
