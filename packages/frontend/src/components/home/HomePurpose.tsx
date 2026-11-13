// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	ChevronRight,
	Hand,
	MessagesSquare,
	ScrollText,
	Zap,
} from "lucide-react";
import { PrismaLensMark } from "@/components/icons/prismalens-mark";
import { Hint } from "@/components/shared/Hint";

/**
 * What the app is, as marks under the question (#1101 first use), in the shell's
 * words only: a trigger starts a thread, it asks when the call is yours, and it
 * leaves a record. Sentences live in the hints; alerts are one trigger among four.
 */
const PURPOSE = [
	{
		icon: Zap,
		word: "Trigger",
		hint: "You, an alert, a webhook or a schedule starts a thread",
	},
	{
		icon: MessagesSquare,
		word: "Thread",
		hint: "The coding agent you already run works it",
	},
	{
		icon: Hand,
		word: "Needs you",
		hint: "It stops and asks when the call is yours",
	},
	{
		icon: ScrollText,
		word: "Record",
		hint: "What every agent did stays on the record",
	},
] as const;

export function HomePurpose() {
	return (
		<div
			className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-meta text-text-3"
			data-testid="home-purpose"
		>
			<span className="inline-flex items-center gap-1.5 font-medium text-text-2">
				<PrismaLensMark aria-hidden className="size-3.5 shrink-0" />
				PrismaLens
			</span>
			<ol
				aria-label="What PrismaLens does"
				className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1"
			>
				{PURPOSE.map((p, i) => (
					<li key={p.word} className="inline-flex items-center gap-1.5">
						{i > 0 && (
							<ChevronRight aria-hidden className="size-3 text-text-3" />
						)}
						<Hint label={p.hint}>
							<span className="inline-flex items-center gap-1.5">
								<p.icon
									aria-hidden
									className="size-3.5 shrink-0 stroke-[1.75]"
								/>
								{p.word}
							</span>
						</Hint>
					</li>
				))}
			</ol>
		</div>
	);
}
