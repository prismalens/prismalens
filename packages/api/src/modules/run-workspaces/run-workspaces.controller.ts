// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller, UseGuards } from "@nestjs/common";
import { Implement, implement, ORPCError } from "@orpc/nest";
import { runWorkspacesContract } from "@prismalens/contracts";
import type { Request } from "express";
import { isOwner, requireOwner } from "../../core/auth/owner.js";
import { MutationThrottleGuard } from "../../core/throttle/mutation-throttle.guard.js";
import {
	RunWorkspaceNotFoundError,
	RunWorkspacesService,
} from "./run-workspaces.service.js";

/** Setup and teardown run shell commands on the host, so only the owner edits them. */
const RUN_WORKSPACES_OWNER_ONLY = "Only the owner can change run workspaces.";

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
					canEdit: isOwner(context.request),
				}),
			),
			update: implement(runWorkspacesContract.update).handler(
				async ({ input, context }) => {
					requireOwner(context.request, RUN_WORKSPACES_OWNER_ONLY);
					return { ...(await this.service.setGlobal(input)), canEdit: true };
				},
			),
			updateCopies: implement(runWorkspacesContract.updateCopies).handler(
				async ({ input, context }) => {
					requireOwner(context.request, RUN_WORKSPACES_OWNER_ONLY);
					return {
						...(await this.service.setCopies(input.location)),
						canEdit: true,
					};
				},
			),
			getService: implement(runWorkspacesContract.getService).handler(
				async ({ input, context }) => ({
					...(await notFoundAsync(() =>
						this.service.getService(input.serviceId),
					)),
					canEdit: isOwner(context.request),
				}),
			),
			updateService: implement(runWorkspacesContract.updateService).handler(
				async ({ input, context }) => {
					requireOwner(context.request, RUN_WORKSPACES_OWNER_ONLY);
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
			kept: implement(runWorkspacesContract.kept).handler(
				async ({ context }) => ({
					workspaces: await this.service.listKept(),
					canEdit: isOwner(context.request),
				}),
			),
			listForRun: implement(runWorkspacesContract.listForRun).handler(
				async ({ input, context }) => ({
					workspaces: await this.service.listForRun(input.runId),
					canEdit: isOwner(context.request),
				}),
			),
			remove: implement(runWorkspacesContract.remove).handler(
				async ({ input, context }) => {
					requireOwner(context.request, RUN_WORKSPACES_OWNER_ONLY);
					return notFoundAsync(() =>
						this.service.remove(input.runId, input.dir),
					);
				},
			),
			open: implement(runWorkspacesContract.open).handler(
				({ input, context }) => {
					requireOwner(context.request, RUN_WORKSPACES_OWNER_ONLY);
					return notFound(() => this.service.open(input.runId, input.dir));
				},
			),
			openInEditor: implement(runWorkspacesContract.openInEditor).handler(
				async ({ input, context }) => {
					requireOwner(context.request, RUN_WORKSPACES_OWNER_ONLY);
					return notFoundAsync(() => this.service.openInEditor(input));
				},
			),
		};
	}
}
