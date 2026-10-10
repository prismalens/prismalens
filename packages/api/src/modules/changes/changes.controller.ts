// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller } from "@nestjs/common";
import { Implement, implement, ORPCError } from "@orpc/nest";
import { changesContract } from "@prismalens/contracts";
import { ChangeEventsService } from "./change-events.service.js";

@Controller()
export class ChangesController {
	constructor(private readonly changes: ChangeEventsService) {}

	@Implement(changesContract)
	changesRouter() {
		return {
			forIncident: implement(changesContract.forIncident).handler(
				async ({ input }) => {
					const result = await this.changes.forIncident(input.id, {
						limit: input.limit,
						refresh: input.refresh,
					});
					if (!result)
						throw new ORPCError("NOT_FOUND", {
							message: `Incident ${input.id} not found`,
						});
					return result;
				},
			),
		};
	}
}
