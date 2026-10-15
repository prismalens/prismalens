// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller } from "@nestjs/common";
import { Implement, implement, ORPCError } from "@orpc/nest";
import { caseFilesContract } from "@prismalens/contracts";
import {
	BindingNotFoundError,
	BindingRefusedError,
	BindingsService,
	ServiceNotFoundError,
} from "./bindings.service.js";

function toOrpcError(err: unknown): never {
	if (
		err instanceof ServiceNotFoundError ||
		err instanceof BindingNotFoundError
	) {
		throw new ORPCError("NOT_FOUND", { message: err.message });
	}
	if (err instanceof BindingRefusedError) {
		throw new ORPCError("BAD_REQUEST", {
			message: err.message,
			data: { reason: err.reason },
		});
	}
	throw err;
}

/** Case File routes (experiment, Setting `case_file`); auth is the global guard. */
@Controller()
export class CaseFilesController {
	constructor(private readonly bindingsService: BindingsService) {}

	@Implement(caseFilesContract.bindings)
	bindings() {
		return {
			detect: implement(caseFilesContract.bindings.detect).handler(
				({ input }) => this.bindingsService.detect(input.serviceId),
			),
			get: implement(caseFilesContract.bindings.get).handler(({ input }) =>
				this.bindingsService.get(input.serviceId),
			),
			confirm: implement(caseFilesContract.bindings.confirm).handler(
				({ input }) => this.bindingsService.confirm(input).catch(toOrpcError),
			),
			probe: implement(caseFilesContract.bindings.probe).handler(({ input }) =>
				this.bindingsService.probe(input.serviceId).catch(toOrpcError),
			),
			remove: implement(caseFilesContract.bindings.remove).handler(
				async ({ input }) => ({
					success: await this.bindingsService.remove(input.serviceId),
				}),
			),
		};
	}
}
