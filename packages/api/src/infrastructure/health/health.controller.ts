// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller, Get } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EnvironmentVariables } from "@prismalens/config";
import { Public } from "../../core/auth/public.decorator.js";
import {
	type TelemetryNoticeState,
	TelemetryService,
} from "../../core/telemetry/telemetry.service.js";
import { resolveServiceVersion } from "../../shared/utils/service-version.js";

interface HealthResponse {
	status: "ok" | "degraded" | "error";
	timestamp: string;
	version: string;
	services: {
		api: boolean;
	};
	/**
	 * Usage data (#673 w45): `notice` on the boot that shows the first-run
	 * notice, or while nobody has seen it; `pl up` prints it then. Carries the
	 * state of a preference, no identifier and no install id.
	 */
	telemetry: TelemetryNoticeState;
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
		const telemetry = await this.telemetry
			.noticeState()
			.catch((): TelemetryNoticeState => "off");
		return {
			status: "ok",
			timestamp: new Date().toISOString(),
			version: resolveServiceVersion(),
			services: {
				api: true,
			},
			telemetry,
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
