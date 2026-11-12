// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { parseReport } from "@prismalens/engine";
import {
	defineHarnessTool,
	type HarnessTool,
	registered,
} from "@prismalens/integrations/harness";
import { z } from "zod";
import { FOR_A_REPORT } from "./serves.js";

/** `parseReport` joins zod's issues as "path: message; path: message". */
function problemsOf(failure: {
	reason: string;
	detail: string;
}): { field: string; expected: string }[] {
	if (failure.reason !== "schema")
		return [{ field: "report", expected: failure.detail }];
	return failure.detail.split("; ").map((issue) => {
		const at = issue.indexOf(": ");
		return at < 0
			? { field: "report", expected: issue }
			: { field: issue.slice(0, at), expected: issue.slice(at + 2) };
	});
}

export function reportTools(): HarnessTool[] {
	return [
		defineHarnessTool({
			...registered("pl_report_validate"),
			group: "knowledge",
			serves: FOR_A_REPORT,
			input: z.object({ report: z.string().min(1).max(200_000) }),
			run: async ({ report }) => {
				const parsed = parseReport(report);
				return {
					value: parsed.ok
						? { valid: true }
						: {
								valid: false,
								problems: problemsOf(parsed),
								next: "Fix each field, then call pl_report_validate again with the whole answer.",
							},
				};
			},
		}),
	];
}
