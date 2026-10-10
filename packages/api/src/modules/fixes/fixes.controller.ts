// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { fixesContract } from "@prismalens/contracts";
import { FixesService } from "./fixes.service.js";

@Controller()
export class FixesController {
	constructor(private readonly fixes: FixesService) {}

	@Implement(fixesContract)
	fixesRouter() {
		return {
			forInvestigation: implement(fixesContract.forInvestigation).handler(
				({ input }) => this.fixes.forInvestigation(input.id),
			),
			apply: implement(fixesContract.apply).handler(({ input }) =>
				this.fixes.apply(input.id),
			),
			undo: implement(fixesContract.undo).handler(({ input }) =>
				this.fixes.undo(input.id),
			),
			check: implement(fixesContract.check).handler(({ input }) =>
				this.fixes.check(input.id),
			),
		};
	}
}
