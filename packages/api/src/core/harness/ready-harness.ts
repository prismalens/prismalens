// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ORPCError } from "@orpc/nest";
import type { RunChoice } from "@prismalens/contracts";
import type { HarnessService } from "./harness.service.js";

/** Refuses a run before anything is written when its agent cannot start (#520, ADR-0031). */
export async function requireReadyHarness(
	harness: Pick<HarnessService, "resolveSelection" | "ensureReady">,
	requested: RunChoice = {},
): Promise<void> {
	const selection = await harness.resolveSelection(requested);
	if (!selection.runnable) {
		throw new ORPCError("PRECONDITION_FAILED", {
			message: selection.reason,
			data: {
				failure: selection.failure,
				reason: selection.reason,
				harness: selection.harness,
			},
		});
	}
	const readiness = await harness.ensureReady(selection.harness);
	if (!readiness.ready) {
		throw new ORPCError("PRECONDITION_FAILED", {
			message: readiness.reason,
			data: {
				failure: "not-ready",
				reason: readiness.reason,
				harness: selection.harness,
			},
		});
	}
}
