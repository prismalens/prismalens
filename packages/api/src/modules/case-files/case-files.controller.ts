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
import { CaseFileSettingsService } from "./case-file-settings.service.js";
import {
	ArtifactUnavailableError,
	CaptureRefusedError,
	CaseNotFoundError,
	CaseViewService,
} from "./case-view.service.js";

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

function toCaseError(err: unknown): never {
	if (err instanceof CaseNotFoundError)
		throw new ORPCError("NOT_FOUND", { message: err.message });
	if (err instanceof ArtifactUnavailableError)
		throw new ORPCError("CONFLICT", {
			message: err.message,
			data: { reason: err.reason },
		});
	if (err instanceof CaptureRefusedError)
		throw new ORPCError("PRECONDITION_FAILED", {
			message: err.message,
			data: { reason: err.reason },
		});
	throw err;
}

/** Case File routes (experiment, Setting `case_file`); auth is the global guard. */
@Controller()
export class CaseFilesController {
	constructor(
		private readonly bindingsService: BindingsService,
		private readonly caseViews: CaseViewService,
		private readonly settings: CaseFileSettingsService,
	) {}

	@Implement(caseFilesContract.settings)
	caseFileSettings() {
		return {
			get: implement(caseFilesContract.settings.get).handler(async () => ({
				enabled: await this.settings.isEnabled(),
			})),
			update: implement(caseFilesContract.settings.update).handler(
				async ({ input }) => {
					await this.settings.set(input.enabled);
					return { enabled: input.enabled };
				},
			),
		};
	}

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

	@Implement(caseFilesContract.cases)
	cases() {
		return {
			get: implement(caseFilesContract.cases.get).handler(({ input }) =>
				this.caseViews.get(input.incidentId, input.asOf).catch(toCaseError),
			),
			artifact: implement(caseFilesContract.cases.artifact).handler(
				({ input }) =>
					this.caseViews.artifact(input.artifactId).catch(toCaseError),
			),
			verify: implement(caseFilesContract.cases.verify).handler(({ input }) =>
				this.caseViews.verify(input.incidentId).catch(toCaseError),
			),
			capture: implement(caseFilesContract.cases.capture).handler(({ input }) =>
				this.caseViews.capture(input.incidentId).catch(toCaseError),
			),
		};
	}
}
