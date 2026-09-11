// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller, UseGuards } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { Implement, implement, ORPCError } from "@orpc/nest";
import { settingsContract } from "@prismalens/contracts";
import { HarnessService } from "../harness/harness.service.js";
import { SettingsService } from "./settings.service.js";

@UseGuards(ThrottlerGuard)
@Controller()
export class SettingsController {
	constructor(
		private readonly settingsService: SettingsService,
		private readonly harnessService: HarnessService,
	) {}

	/**
	 * Implement the settings contract for LLM configuration
	 */
	/**
	 * Implement investigation policy routes
	 */
	@Implement(settingsContract.investigation)
	investigation() {
		return {
			getPolicies: implement(
				settingsContract.investigation.getPolicies,
			).handler(async () => {
				return this.settingsService.getInvestigationPolicies();
			}),

			updatePolicy: implement(
				settingsContract.investigation.updatePolicy,
			).handler(async ({ input }) => {
				const { tier, ...policy } = input;
				return this.settingsService.updateInvestigationPolicy(tier, policy);
			}),

			getLimits: implement(settingsContract.investigation.getLimits).handler(
				async () => {
					return this.settingsService.getInvestigationLimits();
				},
			),

			updateLimits: implement(
				settingsContract.investigation.updateLimits,
			).handler(async ({ input }) => {
				return this.settingsService.updateInvestigationLimits(input);
			}),
		};
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
		};
	}
}
