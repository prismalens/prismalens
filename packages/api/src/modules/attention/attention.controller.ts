// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller } from "@nestjs/common";
import { Implement, implement, ORPCError } from "@orpc/nest";
import { attentionContract } from "@prismalens/contracts";
import type { Request } from "express";
import { AttentionService } from "./attention.service.js";

function deviceOf(request: Request | undefined): string {
	const id = request?.operator?.device.id;
	if (!id)
		throw new ORPCError("UNAUTHORIZED", { message: "Pair this device first." });
	return id;
}

/** Read state is the one operator's, on whichever device (#1101 category 3). */
@Controller()
export class AttentionController {
	constructor(private readonly attention: AttentionService) {}

	@Implement(attentionContract)
	routes() {
		return {
			events: implement(attentionContract.events).handler(({ input }) =>
				this.attention.events(input),
			),
			markRead: implement(attentionContract.markRead).handler(
				async ({ input }) => ({
					marked: await this.attention.markRead(input.ids),
				}),
			),
			away: implement(attentionContract.away).handler(() =>
				this.attention.away(),
			),
			threadRead: implement(attentionContract.threadRead).handler(({ input }) =>
				this.attention.threadRead(input.id),
			),
			markThreadRead: implement(attentionContract.markThreadRead).handler(
				async ({ input }) => ({
					advanced: await this.attention.markThreadRead(input.id, input.key),
				}),
			),
			presence: implement(attentionContract.presence).handler(
				({ input, context }) =>
					this.attention.hold(
						deviceOf(context?.request as Request | undefined),
						input.threadId,
						input.visible,
					),
			),
			prefs: implement(attentionContract.prefs).handler(() =>
				this.attention.prefs(),
			),
			setPrefs: implement(attentionContract.setPrefs).handler(({ input }) =>
				this.attention.setPrefs(input),
			),
			follow: implement(attentionContract.follow).handler(async ({ input }) => {
				const done = await this.attention.setFollow(input.id, input.follow);
				if (!done)
					throw new ORPCError("NOT_FOUND", { message: "Thread not found" });
				return done;
			}),
		};
	}
}
