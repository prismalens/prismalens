// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller, UseGuards } from "@nestjs/common";
import { Implement, implement, ORPCError } from "@orpc/nest";
import type { HarnessId } from "@prismalens/config/harness";
import { settingsContract } from "@prismalens/contracts";
import { requireHostOwner } from "../auth/host.js";
import { isOwner, requireOwner } from "../auth/owner.js";
import {
	AgentSetupError,
	AgentSetupService,
} from "../harness/agent-setup.service.js";
import {
	HarnessService,
	HarnessSettingsError,
} from "../harness/harness.service.js";
import { HarnessRefreshService } from "../harness/harness-refresh.service.js";
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
		private readonly refresh: HarnessRefreshService,
		private readonly agentSetup: AgentSetupService,
	) {}

	/** Settings → About (#717), with the update verdict for this caller (#724) */
	@Implement(settingsContract.about)
	about() {
		return {
			get: implement(settingsContract.about.get).handler(({ context }) =>
				this.updateService.aboutFor(isOwner(context.request)),
			),
			diagnostics: implement(settingsContract.about.diagnostics).handler(
				async ({ context }) => {
					requireOwner(context.request, "Only the owner can run diagnostics.");
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
			// Check now makes the server call out, so it is the host's to ask, like install (#724).
			check: implement(settingsContract.update.check).handler(
				async ({ context }) => {
					requireOwner(
						context.request,
						"Only the owner can check for updates.",
					);
					return this.updateService.aboutFor(true, true);
				},
			),
			install: implement(settingsContract.update.install).handler(
				({ input, context }) =>
					refusals(() =>
						this.updateService.install(input.version, isOwner(context.request)),
					),
			),
			status: implement(settingsContract.update.status).handler(() =>
				this.updateService.getStatus(),
			),
			prefs: implement(settingsContract.update.prefs).handler(
				({ input, context }) =>
					refusals(() =>
						this.updateService.setPrefs(input, isOwner(context.request)),
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
				({ input, context }) => {
					requireOwner(
						context.request,
						"Only the owner can change usage data.",
					);
					return this.telemetryService.update(input);
				},
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
				async ({ input, context }) => {
					requireOwner(context.request, "Only the owner can reset data.");
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
				async ({ input, context }) => {
					requireOwner(context.request, "Only the owner can reset PrismaLens.");
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
					canEditRuntime: isOwner(context.request),
				}),
			),
			updateSettings: implement(
				settingsContract.harnesses.updateSettings,
			).handler(async ({ input, context }) => {
				const host = isOwner(context.request);
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
			checkAllHarnesses: implement(
				settingsContract.harnesses.checkAllHarnesses,
			).handler(async () => this.refresh.checkAll()),
		};
	}

	/**
	 * What loads, and the PrismaLens set (#1180 §3.1, §3.3). Approving, previewing and revealing
	 * answer only the host's own local session, never a paired device.
	 */
	@Implement(settingsContract.agentSetup)
	agentSetupRoutes() {
		const c = settingsContract.agentSetup;
		const s = this.agentSetup;
		const guard = async <T>(run: () => Promise<T>): Promise<T> => {
			try {
				return await run();
			} catch (error) {
				if (error instanceof AgentSetupError)
					throw new ORPCError(error.code, { message: error.message });
				throw error;
			}
		};
		return {
			loadout: implement(c.loadout).handler(({ input }) =>
				guard(() => s.loadout(input)),
			),
			sharedSet: implement(c.sharedSet).handler(() => s.sharedSet()),
			updateSharedSet: implement(c.updateSharedSet).handler(
				({ input, context }) => {
					requireOwner(context.request);
					return guard(() => s.updateSharedSet(input));
				},
			),
			approveSharedServer: implement(c.approveSharedServer).handler(
				({ input, context }) => {
					requireHostOwner(context.request);
					return guard(() => s.approveSharedServer(input));
				},
			),
			removeSharedServer: implement(c.removeSharedServer).handler(
				({ input, context }) => {
					requireOwner(context.request);
					return guard(() => s.removeSharedServer(input.name));
				},
			),
			setSharedMembership: implement(c.setSharedMembership).handler(
				({ input, context }) => {
					requireOwner(context.request);
					return guard(() => s.setMembership(input.id, input.member));
				},
			),
			sharedSources: implement(c.sharedSources).handler(() =>
				s.sharedSources(),
			),
			previewSharedServer: implement(c.previewSharedServer).handler(
				({ input, context }) => {
					requireHostOwner(context.request);
					return guard(() => s.preview(input));
				},
			),
			revealSharedServerRow: implement(c.revealSharedServerRow).handler(
				({ input, context }) => {
					requireHostOwner(context.request);
					return guard(() => s.reveal(input));
				},
			),
		};
	}
}
