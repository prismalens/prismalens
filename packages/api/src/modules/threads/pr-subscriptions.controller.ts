// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { prSubscriptionsContract } from "@prismalens/contracts";
import { requireOperate } from "../../core/auth/owner.js";
import { PrSubscriptionsService } from "./pr-subscriptions/pr-subscriptions.service.js";

/** A thread's PR subscriptions (#1179): what the panel lists, starts, cancels and retries. */
@Controller()
export class PrSubscriptionsController {
	constructor(private readonly subscriptions: PrSubscriptionsService) {}

	@Implement(prSubscriptionsContract)
	routes() {
		return {
			// GET /threads/:id/pr-subscriptions
			list: implement(prSubscriptionsContract.list).handler(({ input }) =>
				this.subscriptions.list(input.id, input.prId),
			),

			// POST /threads/:id/pr-subscriptions - Start, change or resume the user's subscription
			create: implement(prSubscriptionsContract.create).handler(
				({ input, context }) => {
					requireOperate(context.request);
					return this.subscriptions.createFromUser(
						input.id,
						input.prId,
						input.spec,
						input.fromId,
					);
				},
			),

			// DELETE /threads/:id/pr-subscriptions/:subscriptionId
			cancel: implement(prSubscriptionsContract.cancel).handler(
				({ input, context }) => {
					requireOperate(context.request);
					return this.subscriptions.cancelFromUser(
						input.id,
						input.subscriptionId,
					);
				},
			),

			// POST /threads/:id/pr-subscriptions/retry - Parked deliveries go out again
			retry: implement(prSubscriptionsContract.retry).handler(
				({ input, context }) => {
					requireOperate(context.request);
					return this.subscriptions.retry(input.id);
				},
			),

			// POST /threads/:id/pr-subscriptions/poll - Read now, unless the origin cools down
			poll: implement(prSubscriptionsContract.poll).handler(
				({ input, context }) => {
					requireOperate(context.request);
					return this.subscriptions.pollThread(input.id);
				},
			),
		};
	}
}
