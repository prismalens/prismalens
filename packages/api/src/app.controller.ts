// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller, Get } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EnvironmentVariables } from "@prismalens/config";
import { Public } from "./core/auth/public.decorator.js";
import { resolveServiceVersion } from "./shared/utils/service-version.js";

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
			version: resolveServiceVersion(),
			// Always COMMUNITY here: a non-free edition never ships in this repo,
			// it arrives through the capability-flag + dynamic-module seam (ADR 0023,
			// #264), which sets this from outside. Not a pending TODO (#564).
			edition: "COMMUNITY",
			docs: "/api",
		};
	}
}
