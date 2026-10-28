// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { InvestigationReport } from "@prismalens/contracts/schemas";

/**
 * A service check becomes an incident's run only on a finding: a hypothesis the run
 * confirmed or supported, with at least one thing a tool showed that backs it. The
 * culprit is not read (#979, adversary OBJ-010).
 */
export function meetsPromotionRule(
	report: Pick<InvestigationReport, "hypotheses"> | null | undefined,
): boolean {
	return (report?.hypotheses ?? []).some(
		(h) =>
			(h.status === "confirmed" || h.status === "supported") &&
			h.evidence.some(
				(e) => e.status === "verified" && e.direction === "supports",
			),
	);
}
