// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller, Logger, UseGuards } from "@nestjs/common";
import { Implement, implement, ORPCError } from "@orpc/nest";
import {
	claimOperatorLink,
	PairingError,
	prismaPairingStore,
} from "@prismalens/auth";
import { terminalContract } from "@prismalens/contracts";
import type { Request } from "express";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { MutationThrottleGuard } from "../../core/throttle/mutation-throttle.guard.js";
import { TerminalService } from "./terminal.service.js";
import { issueTerminalKey } from "./terminal-key-issue.js";

@UseGuards(MutationThrottleGuard)
@Controller()
export class TerminalController {
	private readonly logger = new Logger(TerminalController.name);

	constructor(
		private readonly terminal: TerminalService,
		private readonly prisma: PrismaService,
	) {}

	@Implement(terminalContract)
	terminalRoutes() {
		return {
			availability: implement(terminalContract.availability).handler(
				async ({ input, context }) => {
					const request = context.request as Request;
					const device = request.operator?.device ?? null;
					const loaded = this.terminal.gate.isHostRequest(request, device)
						? (await this.terminal.loadPty()) !== null
						: false;
					return this.terminal.gate.availability(
						request,
						device,
						input.key,
						loaded,
					);
				},
			),
			ticket: implement(terminalContract.ticket).handler(
				async ({ input, context }) => {
					const request = context.request as Request;
					const minted = await this.terminal.gate.mintTicket(
						request,
						request.operator?.device ?? null,
						input.key,
					);
					if ("reason" in minted) {
						throw new ORPCError("FORBIDDEN", {
							message: "The terminal opens only on the host.",
							data: { reason: minted.reason },
						});
					}
					return {
						ticket: minted.ticket,
						expiresAt: minted.expiresAt.toISOString(),
					};
				},
			),
			claimKey: implement(terminalContract.claimKey).handler(
				async ({ input, context }) => {
					const request = context.request as Request;
					const device = request.operator?.device;
					// Checked before the link is spent, so a refused caller cannot burn the operator's link.
					if (!device || !this.terminal.gate.isHostRequest(request, device)) {
						throw new ORPCError("FORBIDDEN", {
							message: "The terminal opens only on the host.",
							data: { reason: "not-host" },
						});
					}
					try {
						await claimOperatorLink(
							prismaPairingStore(this.prisma),
							input.token,
						);
					} catch (error) {
						if (error instanceof PairingError) {
							this.logger.warn(error.message);
							throw new ORPCError("BAD_REQUEST", {
								message: error.message,
								data: { reason: error.reason },
							});
						}
						throw error;
					}
					const key = issueTerminalKey(request, device);
					if (!key)
						throw new ORPCError("FORBIDDEN", { data: { reason: "not-host" } });
					return { key };
				},
			),
		};
	}
}
