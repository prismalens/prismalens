// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	defineHarnessTool,
	fail,
	type HarnessTool,
	registered,
} from "@prismalens/integrations/harness";
import { z } from "zod";
import { ANYWHERE } from "./serves.js";

/** One cited message's turn: ids PrismaLens checked, and the turn's text fenced as data. */
export interface CitedTurnView {
	threadId: string;
	key: string;
	turn: number;
	link: string;
	body: string;
}

/** Messages the user cited into a run's thread from other threads (#1195). */
export interface CitationsData {
	/** Null unless this run's thread cited that message. */
	turn(
		runId: string,
		threadId: string,
		key: string,
	): Promise<CitedTurnView | null>;
}

export function citationTools(data: CitationsData): HarnessTool[] {
	return [
		defineHarnessTool({
			...registered("pl_citation_read"),
			group: "knowledge",
			serves: ANYWHERE,
			input: z.object({
				threadId: z.string().uuid(),
				key: z
					.string()
					.trim()
					.regex(/^[\w.-]{1,120}:\d{1,9}$/),
			}),
			run: async ({ threadId, key }, ctx) => {
				const t = await data.turn(ctx.runId, threadId, key);
				if (!t)
					return fail(
						"not_found",
						`No message ${key} of thread ${threadId} was cited into this thread.`,
						"Pass threadId and key exactly as a citation in the user's message names them, or answer from the excerpt.",
					);
				return { value: t };
			},
		}),
	];
}
