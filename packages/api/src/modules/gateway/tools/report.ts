// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { parseReport } from "@prismalens/engine";
import {
	defineHarnessTool,
	type HarnessTool,
} from "@prismalens/integrations/harness";
import { z } from "zod";

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
			name: "report_validate",
			title: "Check your final report",
			description:
				"Check your final report before you finish; PrismaLens rejects a report that fails this. Pass the full final answer you intend to give, including its fenced json block. Returns valid, or each field that fails and what it expects.",
			group: "knowledge",
			effect: "read",
			input: z.object({ report: z.string().min(1).max(200_000) }),
			run: async ({ report }) => {
				const parsed = parseReport(report);
				return {
					value: parsed.ok
						? { valid: true }
						: {
								valid: false,
								problems: problemsOf(parsed),
								next: "Fix each field, then call report_validate again with the whole answer.",
							},
				};
			},
		}),
	];
}
