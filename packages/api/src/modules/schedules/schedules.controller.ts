// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller, UseGuards } from "@nestjs/common";
import { Implement, implement, ORPCError } from "@orpc/nest";
import { ACCESS_SCOPE, STARTUP_LINK_LABEL } from "@prismalens/auth";
import { SCHEDULE_HOST_ONLY, schedulesContract } from "@prismalens/contracts";
import type { Request } from "express";
import { MutationThrottleGuard } from "../../core/throttle/mutation-throttle.guard.js";
import { ScheduleError, SchedulesService } from "./schedules.service.js";

/** Every device reads; only the host's session writes, as #907 rules for agent settings (#979, #982). */
function isHost(request: Request): boolean {
	return !!request.operator?.device.scopes.includes(ACCESS_SCOPE);
}

function hostOnly(request: Request): string | null {
	if (!isHost(request))
		throw new ORPCError("FORBIDDEN", { message: SCHEDULE_HOST_ONLY });
	return request.operator?.device.id ?? null;
}

async function mapped<T>(work: () => Promise<T>): Promise<T> {
	try {
		return await work();
	} catch (error) {
		if (error instanceof ScheduleError)
			throw new ORPCError(error.code, { message: error.message });
		throw error;
	}
}

@UseGuards(MutationThrottleGuard)
@Controller()
export class SchedulesController {
	constructor(private readonly schedules: SchedulesService) {}

	@Implement(schedulesContract)
	routes() {
		const access = (request: Request) => ({
			canEdit: isHost(request),
			hostName: STARTUP_LINK_LABEL,
		});
		return {
			list: implement(schedulesContract.list).handler(async ({ context }) => ({
				...access(context.request),
				...(await this.schedules.list()),
			})),
			get: implement(schedulesContract.get).handler(({ input, context }) =>
				mapped(async () => ({
					...access(context.request),
					...(await this.schedules.get(input.id, input.cursor, input.limit)),
				})),
			),
			preview: implement(schedulesContract.preview).handler(({ input }) =>
				this.schedules.preview(input.recurrence),
			),
			create: implement(schedulesContract.create).handler(
				async ({ input, context }) => {
					const device = hostOnly(context.request);
					return mapped(() => this.schedules.create(input, device));
				},
			),
			update: implement(schedulesContract.update).handler(
				async ({ input, context }) => {
					const device = hostOnly(context.request);
					return mapped(() =>
						this.schedules.update(
							input.id,
							input.revision,
							input.schedule,
							device,
						),
					);
				},
			),
			setEnabled: implement(schedulesContract.setEnabled).handler(
				async ({ input, context }) => {
					const device = hostOnly(context.request);
					return mapped(() =>
						this.schedules.setEnabled(input.id, input.enabled, device),
					);
				},
			),
			runNow: implement(schedulesContract.runNow).handler(
				async ({ input, context }) => {
					const device = hostOnly(context.request);
					return mapped(() => this.schedules.runNow(input.id, device));
				},
			),
			remove: implement(schedulesContract.remove).handler(
				async ({ input, context }) => {
					const device = hostOnly(context.request);
					return mapped(() => this.schedules.remove(input.id, device));
				},
			),
		};
	}
}
