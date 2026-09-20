// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller, Get } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EnvironmentVariables } from "@prismalens/config";
import { Public } from "../../core/auth/public.decorator.js";
import { TelemetryService } from "../../core/telemetry/telemetry.service.js";
import { resolveServiceVersion } from "../../shared/utils/service-version.js";

interface HealthResponse {
	status: "ok" | "degraded" | "error";
	timestamp: string;
	version: string;
	services: {
		api: boolean;
	};
	/**
	 * Whether the owner has answered the usage-data question (#602). `pl up`
	 * reads this from its readiness probe to print one pointer at Settings; it
	 * never prompts, and there is no CLI way to answer. Carries the state of a
	 * preference, no identifier and no install id.
	 */
	telemetry: "undecided" | "on" | "off";
}

@Public()
@Controller("health")
export class HealthController {
	constructor(
		readonly _configService: ConfigService<EnvironmentVariables>,
		private readonly telemetry: TelemetryService,
	) {}

	@Get()
	async health(): Promise<HealthResponse> {
		const settings = await this.telemetry
			.getSettings()
			.catch(() => ({ enabled: false, decided: true, forcedOff: false }));
		return {
			status: "ok",
			timestamp: new Date().toISOString(),
			version: resolveServiceVersion(),
			services: {
				api: true,
			},
			telemetry: !settings.decided
				? "undecided"
				: settings.enabled
					? "on"
					: "off",
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
