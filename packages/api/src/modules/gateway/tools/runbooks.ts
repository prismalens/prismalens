// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	defineHarnessTool,
	fail,
	type HarnessTool,
	registered,
} from "@prismalens/integrations/harness";
import { z } from "zod";
import { RUNBOOK_CHARS, type RunbooksData } from "../runbooks.js";
import { SCOPED } from "./serves.js";

export function runbookTools(data: RunbooksData): HarnessTool[] {
	return [
		defineHarnessTool({
			...registered("pl_runbooks_list"),
			group: "knowledge",
			serves: SCOPED,
			input: z.object({
				service: z.string().trim().min(1).max(200).optional(),
			}),
			run: async ({ service }, ctx) => {
				const runbooks = await data.list(ctx.runId, service);
				return {
					value: runbooks.length
						? { runbooks }
						: { status: "not-configured", runbooks: [] },
				};
			},
		}),
		defineHarnessTool({
			...registered("pl_runbooks_read"),
			group: "core",
			serves: SCOPED,
			input: z.object({
				path: z.string().trim().min(1).max(1_000),
				service: z.string().trim().min(1).max(200),
			}),
			run: async ({ path, service }, ctx) => {
				const r = await data.read(ctx.runId, path, service);
				if (r.ok) return { value: r };
				return r.disabled
					? fail(
							"disabled",
							"Runbook discovery is turned off in PrismaLens.",
							"Do not retry; read the repository's own docs with your file tools.",
						)
					: fail(
							"not_found",
							r.error,
							"Call pl_runbooks_list and pass a path and service exactly as it returned them.",
						);
			},
		}),
	];
}
