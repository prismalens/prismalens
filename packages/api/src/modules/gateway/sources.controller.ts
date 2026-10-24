// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { sourcesContract } from "@prismalens/contracts";
import { SourcesService } from "./sources.service.js";

/** Sources (#848): the web connect flow calls these. */
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
			oauthStart: implement(sourcesContract.oauthStart).handler(
				({ input, context }) =>
					this.sources.oauthStart(input, originOf(context.request)),
			),
			mcpPreview: implement(sourcesContract.mcpPreview).handler(({ input }) =>
				this.sources.mcpPreview(input),
			),
			rename: implement(sourcesContract.rename).handler(({ input }) =>
				this.sources.rename(input.id, input.name, input.description),
			),
		};
	}
}

/** The browser's Origin; a local origin gets the pinned loopback callback (04). */
function originOf(
	request: { headers?: unknown } | undefined,
): string | undefined {
	const headers = request?.headers as
		| Record<string, string | string[] | undefined>
		| undefined;
	const v = headers?.origin;
	return typeof v === "string" ? v : undefined;
}
