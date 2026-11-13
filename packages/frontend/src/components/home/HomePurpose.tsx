// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { BellRing, Bot, ChevronRight, ClipboardCheck } from "lucide-react";
import { PrismaLensMark } from "@/components/icons/prismalens-mark";
import { Hint } from "@/components/shared/Hint";

/**
 * What the app is, as marks under the question (#1101 first use): the product,
 * then the path it runs: your agents, the alerts that start threads, the cause
 * and next step they report. Sentences live in the hints.
 */
const PURPOSE = [
	{
		icon: Bot,
		word: "Your agents",
		hint: "The coding agents you already run, in one place",
	},
	{
		icon: BellRing,
		word: "Alerts",
		hint: "An alert or webhook starts a thread by itself",
	},
	{
		icon: ClipboardCheck,
		word: "Cause and fix",
		hint: "Each run reports a likely cause and the next command",
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
				className="flex items-center gap-1.5"
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
