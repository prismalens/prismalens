// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller, Get } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiTags } from "@nestjs/swagger";
import { EnvironmentVariables } from "@prismalens/config";
import { Public } from "../../core/auth/public.decorator.js";

interface HealthResponse {
	status: "ok" | "degraded" | "error";
	timestamp: string;
	version: string;
	edition: string;
	services: {
		api: boolean;
		queue: boolean;
	};
}

@Public()
@ApiTags("health")
@Controller("health")
export class HealthController {
	constructor(readonly _configService: ConfigService<EnvironmentVariables>) {}

	@Get()
	health(): HealthResponse {
		return {
			status: "ok",
			timestamp: new Date().toISOString(),
			version: "0.1.0",
			edition: "community", // TODO: Dynamically set based on license
			services: {
				api: true,
				queue: true, // TODO: Check actual queue connection
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
