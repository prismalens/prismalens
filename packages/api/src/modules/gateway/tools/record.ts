// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	EvidenceDirectionSchema,
	HypothesisStatusSchema,
} from "@prismalens/contracts/schemas";
import type {
	EvidenceInput,
	FindingsLedger,
	HypothesisInput,
} from "@prismalens/engine";
import { defineSourceTool, type SourceTool } from "@prismalens/integrations";
import { z } from "zod";

/** What the recording tools write to: the run's ledger, and its workspace for file quotes. */
export interface FindingsData {
	recordEvidence(
		runId: string,
		input: EvidenceInput,
	): Promise<ReturnType<FindingsLedger["addEvidence"]>>;
	recordHypothesis(
		runId: string,
		input: HypothesisInput,
	): Promise<ReturnType<FindingsLedger["addHypothesis"]>>;
}

const EVIDENCE_ID = z
	.string()
	.trim()
	.regex(/^e\d{1,4}$/);
const HYPOTHESIS_ID = z
	.string()
	.trim()
	.regex(/^rh\d{1,4}$/);

/**
 * Evidence and hypotheses the agent records as it works (#930). A result never
 * repeats the quote: it would be a tool output the quote resolves against.
 */
export function recordTools(data: FindingsData): SourceTool[] {
	const base = { category: "knowledge", openWorld: false } as const;
	return [
		defineSourceTool({
			...base,
			name: "evidence_record",
			title: "Record evidence",
			description:
				"Record one piece of evidence as you find it; the run view shows it at once. `quote` is text copied exactly from a tool output you saw in this run, or from the file at `path` in the run's workspace. PrismaLens looks the quote up itself: one it cannot find is kept as unanchored and never counts as verified. Returns the evidence id (e1, e2…) that hypothesis_record links.",
			input: z.object({
				observation: z.string().trim().min(1).max(1_000),
				source: z.string().trim().min(1).max(500),
				quote: z.string().trim().min(4).max(2_000),
				direction: EvidenceDirectionSchema.default("supports"),
				path: z.string().trim().min(1).max(1_000).optional(),
			}),
			run: async (input, ctx) => {
				const r = await data.recordEvidence(ctx.runId, input);
				if ("error" in r) return { isError: true, value: r };
				return {
					value: {
						id: r.id,
						anchor: r.anchor,
						...(r.anchor
							? {}
							: {
									note: r.path
										? "The quote is not in that file; it is recorded unanchored."
										: "No tool output this run saw holds the quote yet; it is recorded unanchored and looked up again when the report is written.",
								}),
					},
				};
			},
		}),
		defineSourceTool({
			...base,
			name: "hypothesis_record",
			title: "Record a hypothesis",
			description:
				"Record a hypothesis, or update one by its `id` (rh1, rh2…), as your thinking changes; the run view shows it at once. `evidence` lists ids evidence_record returned; on an update it replaces the list, and leaving it out keeps it. Give the hypothesis the same `id` in your report, so the report joins its recorded evidence.",
			input: z.object({
				id: HYPOTHESIS_ID.optional(),
				statement: z.string().trim().min(1).max(1_000),
				status: HypothesisStatusSchema,
				evidence: z.array(EVIDENCE_ID).max(50).optional(),
				parentId: HYPOTHESIS_ID.optional(),
			}),
			run: async (input, ctx) => {
				const r = await data.recordHypothesis(ctx.runId, input);
				return "error" in r
					? { isError: true, value: r }
					: { value: { id: r.id, evidence: r.evidenceIds } };
			},
		}),
	];
}
