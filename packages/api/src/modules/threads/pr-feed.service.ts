// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Injectable } from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import type { PrWatch, PullRequest } from "@prismalens/contracts";
import { PrSubscriptionsService } from "./pr-subscriptions/pr-subscriptions.service.js";
import { PullRequestsService } from "./pull-requests.service.js";

/**
 * The panel's Watch and its compact watch line (#1024 surface F), over PR subscriptions
 * (#1179 D3): Watch starts or resumes the thread's user subscription, Stop watching ends
 * its user and automatic ones, and each PR reads as one watch.
 */
@Injectable()
export class PrFeedService {
	constructor(
		private readonly prs: PullRequestsService,
		private readonly subscriptions: PrSubscriptionsService,
	) {}

	/** Each linked PR's watch for the panel; absent when nothing follows it. */
	watches(threadId: string): Promise<Map<string, PrWatch>> {
		return this.subscriptions.watches(threadId);
	}

	/** The PR list with each PR's watch. */
	async withWatches<T extends { pullRequests: PullRequest[] }>(
		threadId: string,
		list: T,
	): Promise<T> {
		const w = await this.watches(threadId);
		return {
			...list,
			pullRequests: list.pullRequests.map((p) => ({
				...p,
				watch: w.get(p.id) ?? null,
			})),
		};
	}

	/** The user's Watch: the thread's user subscription starts, or starts again. */
	async watch(threadId: string, prId: string): Promise<PullRequest> {
		const pr = await this.requirePr(threadId, prId);
		await this.subscriptions.watchFromUser(threadId, prId);
		return { ...pr, watch: (await this.watches(threadId)).get(prId) ?? null };
	}

	/** Stop watching: the thread's user and automatic subscriptions on this PR end. */
	async unwatch(threadId: string, prId: string): Promise<PullRequest> {
		const pr = await this.requirePr(threadId, prId);
		await this.subscriptions.unwatchFromUser(threadId, prId);
		return { ...pr, watch: (await this.watches(threadId)).get(prId) ?? null };
	}

	private async requirePr(threadId: string, prId: string) {
		const pr = (await this.prs.stored(threadId)).find((p) => p.id === prId);
		if (!pr)
			throw new ORPCError("NOT_FOUND", {
				message: "That pull request is not linked to this thread.",
			});
		return pr;
	}
}
