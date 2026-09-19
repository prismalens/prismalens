// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller, Get } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EnvironmentVariables } from "@prismalens/config";
import { Public } from "../../core/auth/public.decorator.js";
import { resolveServiceVersion } from "../../shared/utils/service-version.js";

interface HealthResponse {
	status: "ok" | "degraded" | "error";
	timestamp: string;
	version: string;
	services: {
		api: boolean;
	};
}

@Public()
@Controller("health")
export class HealthController {
	constructor(readonly _configService: ConfigService<EnvironmentVariables>) {}

	@Get()
	health(): HealthResponse {
		return {
			status: "ok",
			timestamp: new Date().toISOString(),
			version: resolveServiceVersion(),
			services: {
				api: true,
			},
		};
	}

	@Get("ready")
	ready(): { ready: boolean } {
		return { ready: true };
	}

	@Get("live")
	live(): { live: boolean } {
		return { live: true };
	}
}
