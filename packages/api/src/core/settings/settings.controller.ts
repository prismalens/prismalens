// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller, UseGuards } from "@nestjs/common";
import { Implement, implement, ORPCError } from "@orpc/nest";
import { ACCESS_SCOPE } from "@prismalens/auth";
import type { HarnessId } from "@prismalens/config/harness";
import { settingsContract } from "@prismalens/contracts";
import type { Request } from "express";
import {
	HarnessService,
	HarnessSettingsError,
} from "../harness/harness.service.js";
import { TelemetryService } from "../telemetry/telemetry.service.js";
import { MutationThrottleGuard } from "../throttle/mutation-throttle.guard.js";
import { DiagnosticsService } from "./diagnostics.service.js";
import { ActiveRunsError, SettingsService } from "./settings.service.js";
import { UpdateRefused, UpdateService } from "./update.service.js";

@UseGuards(MutationThrottleGuard)
@Controller()
export class SettingsController {
	constructor(
		private readonly settingsService: SettingsService,
		private readonly harnessService: HarnessService,
		private readonly telemetryService: TelemetryService,
		private readonly updateService: UpdateService,
		private readonly diagnosticsService: DiagnosticsService,
	) {}

	/** Settings → About (#717), with the update verdict for this caller (#724) */
	@Implement(settingsContract.about)
	about() {
		return {
			get: implement(settingsContract.about.get).handler(({ context }) =>
				this.updateService.aboutFor(isHost(context.request as Request)),
			),
			diagnostics: implement(settingsContract.about.diagnostics).handler(
				async ({ context }) => {
					if (!isHost(context.request as Request))
						throw new ORPCError("FORBIDDEN", {
							message: "Only this machine's own browser can run diagnostics.",
						});
					return this.diagnosticsService.run();
				},
			),
		};
	}

	/** Check now, Install and restart, and the update preferences (#724, #1024 E) */
	@Implement(settingsContract.update)
	update() {
		const refusals = async <T>(work: () => Promise<T>): Promise<T> => {
			try {
				return await work();
			} catch (error) {
				if (error instanceof UpdateRefused)
					throw new ORPCError(error.code, { message: error.message });
				throw error;
			}
		};
		return {
			check: implement(settingsContract.update.check).handler(({ context }) =>
				this.updateService.aboutFor(isHost(context.request as Request), true),
			),
			install: implement(settingsContract.update.install).handler(
				({ input, context }) =>
					refusals(() =>
						this.updateService.install(
							input.version,
							isHost(context.request as Request),
						),
					),
			),
			status: implement(settingsContract.update.status).handler(() =>
				this.updateService.getStatus(),
			),
			prefs: implement(settingsContract.update.prefs).handler(
				({ input, context }) =>
					refusals(() =>
						this.updateService.setPrefs(
							input,
							isHost(context.request as Request),
						),
					),
			),
		};
	}

	/** Usage telemetry, on after a notice (#673 w45) */
	@Implement(settingsContract.telemetry)
	telemetry() {
		return {
			get: implement(settingsContract.telemetry.get).handler(() =>
				this.telemetryService.getSettings(),
			),
			update: implement(settingsContract.telemetry.update).handler(
				({ input }) => this.telemetryService.update(input),
			),
		};
	}

	/**
	 * A fast, friendly refusal before the work starts. It is not the guard: the
	 * reset transaction repeats the check, because a run can be claimed between
	 * this count and the deletes (#662 review). {@link runReset} maps that.
	 */
	private async refuseWhileRunning(): Promise<void> {
		const active = await this.settingsService.activeRunCount();
		if (active > 0) {
			throw new ORPCError("CONFLICT", {
				message: new ActiveRunsError(active).message,
			});
		}
	}

	/** Run a reset, turning a mid-transaction refusal into the same CONFLICT. */
	private async runReset<T>(reset: () => Promise<T>): Promise<T> {
		try {
			return await reset();
		} catch (error) {
			if (error instanceof ActiveRunsError) {
				throw new ORPCError("CONFLICT", { message: error.message });
			}
			throw error;
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
					return this.runReset(() => this.settingsService.resetData());
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
					return this.runReset(() => this.settingsService.factoryReset());
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
				async ({ context }) => ({
					...(await this.harnessService.getSettings()),
					canEditRuntime: isHost(context.request as Request),
				}),
			),
			updateSettings: implement(
				settingsContract.harnesses.updateSettings,
			).handler(async ({ input, context }) => {
				const host = isHost(context.request as Request);
				try {
					const saved = await this.harnessService.updateSettings(input, {
						host,
					});
					return { ...saved, canEditRuntime: host };
				} catch (error) {
					if (error instanceof HarnessSettingsError)
						throw new ORPCError(error.code, { message: error.message });
					throw error;
				}
			}),
			checkHarness: implement(settingsContract.harnesses.checkHarness).handler(
				async ({ input }) => this.harnessService.check(input.id as HarnessId),
			),
		};
	}
}

/** The host's own session holds `admin:access`; a paired device does not (#907 decision 11). */
export function isHost(request: Request): boolean {
	return !!request.operator?.device.scopes.includes(ACCESS_SCOPE);
}
