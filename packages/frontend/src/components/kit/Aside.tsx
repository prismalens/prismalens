// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ChevronLeft, ChevronRight, CornerDownRight, X } from "lucide-react";
import type { ReactNode } from "react";
import { Hint } from "@/components/shared/Hint";
import { Ring } from "@/components/shared/Ring";
import { Button } from "@/components/ui/button";

export interface AsideEntry {
	id: string;
	question: string;
	/** The answer, rendered by the caller's prose component. */
	answer?: ReactNode;
	state: "answering" | "done" | "failed";
	/** The one-line cause when it failed. */
	error?: string;
}

const ICON_BTN =
	"flex size-6 items-center justify-center rounded-control text-text-2 outline-none hover:bg-surface-3 hover:text-text-1 focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40";

/**
 * A side question's answer over the composer (pattern sheet §2): never in
 * the transcript or the agent's context. It keeps the last few; arrows page
 * them, and Keep as thread turns the shown one into a fork.
 */
export function Aside({
	entries,
	index,
	onIndex,
	onClose,
	onKeep,
	onRetry,
}: {
	entries: AsideEntry[];
	index: number;
	onIndex: (i: number) => void;
	onClose: () => void;
	onKeep: (id: string) => void;
	onRetry?: (id: string) => void;
}) {
	const e = entries[index];
	if (!e) return null;
	return (
		<section
			aria-label="Side question"
			className="floating flex max-h-[min(50vh,360px)] flex-col rounded-pool"
			data-testid="aside"
			data-state={e.state}
		>
			<header className="flex min-w-0 items-center gap-2 py-1.5 pr-1.5 pl-3">
				<CornerDownRight
					aria-hidden
					className="size-3.5 shrink-0 stroke-[1.75] text-text-3"
				/>
				<span className="min-w-0 flex-1 truncate text-body text-text-2">
					{e.question}
				</span>
				{entries.length > 1 && (
					<span className="flex shrink-0 items-center">
						<Hint label="Earlier aside">
							<button
								type="button"
								aria-label="Earlier aside"
								className={ICON_BTN}
								disabled={index === 0}
								onClick={() => onIndex(index - 1)}
							>
								<ChevronLeft className="size-3.5" />
							</button>
						</Hint>
						<span className="px-1 text-meta text-text-3 tabular-nums">
							{index + 1}/{entries.length}
						</span>
						<Hint label="Later aside">
							<button
								type="button"
								aria-label="Later aside"
								className={ICON_BTN}
								disabled={index === entries.length - 1}
								onClick={() => onIndex(index + 1)}
							>
								<ChevronRight className="size-3.5" />
							</button>
						</Hint>
					</span>
				)}
				<Hint label="Close" keys={["Esc"]}>
					<button
						type="button"
						aria-label="Close"
						className={ICON_BTN}
						onClick={onClose}
					>
						<X className="size-3.5" />
					</button>
				</Hint>
			</header>
			<div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2 text-body text-text-1">
				{e.state === "answering" && (
					<span className="flex items-center gap-2 text-text-2">
						<Ring />
						Answering
					</span>
				)}
				{e.state === "failed" && (
					<span className="text-danger">{e.error ?? "No answer"}</span>
				)}
				{e.state === "done" && e.answer}
			</div>
			<footer className="flex items-center gap-1 px-1.5 pb-1.5">
				{e.state === "failed" && onRetry ? (
					<Button variant="text" size="sm" onClick={() => onRetry(e.id)}>
						Retry
					</Button>
				) : (
					<Button
						variant="text"
						size="sm"
						disabled={e.state !== "done"}
						onClick={() => onKeep(e.id)}
					>
						Keep as thread
					</Button>
				)}
			</footer>
		</section>
	);
}
