// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller } from "@nestjs/common";
import { Implement, implement, ORPCError } from "@orpc/nest";
import { impactContract } from "@prismalens/contracts";
import { ImpactService } from "./impact.service.js";

@Controller()
export class ImpactController {
	constructor(private readonly impact: ImpactService) {}

	@Implement(impactContract)
	impactRouter() {
		return {
			forIncident: implement(impactContract.forIncident).handler(
				async ({ input }) => {
					const chart = await this.impact.chart(input.id);
					if (!chart)
						throw new ORPCError("NOT_FOUND", {
							message: `Incident ${input.id} not found`,
						});
					return chart;
				},
			),
		};
	}
}
