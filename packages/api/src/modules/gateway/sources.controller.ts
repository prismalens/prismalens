// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { sourcesContract } from "@prismalens/contracts";
import { SourcesService } from "./sources.service.js";

/** Sources (#848): the web connect flow and `pl connect` / `pl sources` call these. */
@Controller()
export class SourcesController {
	constructor(private readonly sources: SourcesService) {}

	@Implement(sourcesContract)
	handlers() {
		return {
			overview: implement(sourcesContract.overview).handler(() =>
				this.sources.overview(),
			),
			test: implement(sourcesContract.test).handler(({ input }) =>
				this.sources.test(input),
			),
			connect: implement(sourcesContract.connect).handler(({ input }) =>
				this.sources.connect(input),
			),
			setRunbooks: implement(sourcesContract.setRunbooks).handler(({ input }) =>
				this.sources.setRunbooks(input.enabled),
			),
			retest: implement(sourcesContract.retest).handler(({ input }) =>
				this.sources.retest(input.id),
			),
		};
	}
}
