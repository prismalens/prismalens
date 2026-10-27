// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller, UseGuards } from "@nestjs/common";
import { Implement, implement, ORPCError } from "@orpc/nest";
import { runWorkspacesContract } from "@prismalens/contracts";
import type { Request } from "express";
import { isHost } from "../../core/settings/settings.controller.js";
import { MutationThrottleGuard } from "../../core/throttle/mutation-throttle.guard.js";
import {
	RunWorkspaceNotFoundError,
	RunWorkspacesService,
} from "./run-workspaces.service.js";

/** Setup and teardown run shell commands on this computer, so only the host's own session edits them. */
function hostOnly(request: unknown): void {
	if (!isHost(request as Request))
		throw new ORPCError("FORBIDDEN", {
			message:
				"Run workspaces can be changed only on the computer PrismaLens runs on.",
		});
}

function notFound<T>(work: () => T): T {
	try {
		return work();
	} catch (e) {
		if (e instanceof RunWorkspaceNotFoundError)
			throw new ORPCError("NOT_FOUND", { message: e.message });
		throw e;
	}
}

async function notFoundAsync<T>(work: () => Promise<T>): Promise<T> {
	try {
		return await work();
	} catch (e) {
		if (e instanceof RunWorkspaceNotFoundError)
			throw new ORPCError("NOT_FOUND", { message: e.message });
		throw e;
	}
}

@UseGuards(MutationThrottleGuard)
@Controller()
export class RunWorkspacesController {
	constructor(private readonly service: RunWorkspacesService) {}

	@Implement(runWorkspacesContract)
	runWorkspaces() {
		return {
			get: implement(runWorkspacesContract.get).handler(
				async ({ context }) => ({
					...(await this.service.getGlobal()),
					canEdit: isHost(context.request as Request),
				}),
			),
			update: implement(runWorkspacesContract.update).handler(
				async ({ input, context }) => {
					hostOnly(context.request);
					return { ...(await this.service.setGlobal(input)), canEdit: true };
				},
			),
			getService: implement(runWorkspacesContract.getService).handler(
				async ({ input, context }) => ({
					...(await notFoundAsync(() =>
						this.service.getService(input.serviceId),
					)),
					canEdit: isHost(context.request as Request),
				}),
			),
			updateService: implement(runWorkspacesContract.updateService).handler(
				async ({ input, context }) => {
					hostOnly(context.request);
					return {
						...(await notFoundAsync(() =>
							this.service.setService(input.serviceId, input.override),
						)),
						canEdit: true,
					};
				},
			),
			removals: implement(runWorkspacesContract.removals).handler(async () => ({
				removals: await this.service.removals(),
			})),
			listForRun: implement(runWorkspacesContract.listForRun).handler(
				({ input, context }) => ({
					workspaces: this.service.listForRun(input.runId),
					canEdit: isHost(context.request as Request),
				}),
			),
			remove: implement(runWorkspacesContract.remove).handler(
				async ({ input, context }) => {
					hostOnly(context.request);
					return notFoundAsync(() =>
						this.service.remove(input.runId, input.dir),
					);
				},
			),
			open: implement(runWorkspacesContract.open).handler(
				({ input, context }) => {
					hostOnly(context.request);
					return notFound(() => this.service.open(input.runId, input.dir));
				},
			),
		};
	}
}
