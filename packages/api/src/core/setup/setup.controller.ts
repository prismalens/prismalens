// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { type SetupStep, setupContract } from "@prismalens/contracts";
import { HarnessService } from "../harness/harness.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

/**
 * The on-ramp status behind the empty-state hints. Nothing here gates the
 * app: there is no account (ADR 0001 §2). It returns booleans only, never a
 * provider name, a checkout path or a count.
 */
@Controller()
export class SetupController {
	constructor(
		private readonly prisma: PrismaService,
		private readonly harnessService: HarnessService,
	) {}

	@Implement(setupContract)
	setup() {
		return {
			// GET /setup/status
			getStatus: implement(setupContract.getStatus).handler(async () => {
				// "Configured" means the ACTIVE provider is runnable, not that some
				// key exists.
				const [aiProvider, mappedServices, incidents] = await Promise.all([
					this.harnessService.resolveSelection().then((s) => s.runnable),
					this.prisma.serviceRepository.count(),
					this.prisma.incident.count(),
				]);
				const steps = {
					aiProvider,
					codeLocation: mappedServices > 0,
					firstIncident: incidents > 0,
				};
				// currentStep is the first incomplete step, in the contract's enum
				// order.
				let currentStep: SetupStep = "complete";
				if (!steps.aiProvider) currentStep = "ai_provider";
				else if (!steps.codeLocation) currentStep = "code_location";
				else if (!steps.firstIncident) currentStep = "first_incident";
				return { steps, currentStep };
			}),
		};
	}
}
