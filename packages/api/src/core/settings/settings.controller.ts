// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller, UseGuards } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { Implement, implement, ORPCError } from "@orpc/nest";
import type { HarnessId } from "@prismalens/config/harness";
import { settingsContract } from "@prismalens/contracts";
import { HarnessService } from "../harness/harness.service.js";
import { HarnessProbeService } from "../harness/harness-probe.service.js";
import { SettingsService } from "./settings.service.js";

@UseGuards(ThrottlerGuard)
@Controller()
export class SettingsController {
	constructor(
		private readonly settingsService: SettingsService,
		private readonly harnessService: HarnessService,
		private readonly harnessProbeService: HarnessProbeService,
	) {}

	private async refuseWhileRunning(): Promise<void> {
		const active = await this.settingsService.activeRunCount();
		if (active > 0) {
			throw new ORPCError("CONFLICT", {
				message: `${active} investigation(s) are queued or running. Cancel them, or wait for them to finish, then reset.`,
			});
		}
	}

	/**
	 * Implement danger zone routes
	 */
	@Implement(settingsContract.danger)
	danger() {
		return {
			resetData: implement(settingsContract.danger.resetData).handler(
				async ({ input }) => {
					if (input.confirmation !== "RESET") {
						throw new ORPCError("BAD_REQUEST", {
							message: "Confirmation required",
						});
					}
					await this.refuseWhileRunning();
					return this.settingsService.resetData();
				},
			),

			factoryReset: implement(settingsContract.danger.factoryReset).handler(
				async ({ input }) => {
					if (input.confirmation !== "FACTORY RESET") {
						throw new ORPCError("BAD_REQUEST", {
							message: "Confirmation required",
						});
					}
					await this.refuseWhileRunning();
					return this.settingsService.factoryReset();
				},
			),
		};
	}

	/**
	 * Implement harness status routes
	 */
	@Implement(settingsContract.harnesses)
	harnesses() {
		return {
			getHarnesses: implement(settingsContract.harnesses.getHarnesses).handler(
				async () => {
					return this.harnessService.getStatus();
				},
			),
			getSettings: implement(settingsContract.harnesses.getSettings).handler(
				async () => this.harnessService.getSettings(),
			),
			updateSettings: implement(
				settingsContract.harnesses.updateSettings,
			).handler(async ({ input }) => this.harnessService.updateSettings(input)),
			checkHarness: implement(settingsContract.harnesses.checkHarness).handler(
				async ({ input }) =>
					this.harnessProbeService.check(input.id as HarnessId),
			),
		};
	}
}
