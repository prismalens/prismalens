// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	FIND_QUERY_MAX,
	FIND_SCOPES,
	type FindScope,
} from "@prismalens/contracts";
import {
	CaseSensitive,
	ChevronDown,
	ChevronUp,
	RotateCw,
	Search,
	X,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { Hint } from "@/components/shared/Hint";
import { Ring } from "@/components/shared/Ring";
import { cn } from "@/lib/utils";
import type { ThreadFind } from "./use-thread-find";

const SCOPE_LABEL: Record<FindScope, string> = {
	all: "All",
	mine: "Mine",
	agent: "Agent",
	tools: "Tools",
};

/**
 * Find, docked as a strip at the top of the transcript column (sheet §2): it
 * never covers text. Scope and case are compact toggles; Escape closes it.
 */
export function FindBar({
	find,
	onClose,
}: {
	find: ThreadFind;
	onClose: () => void;
}) {
	const input = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (!find.open || find.focus === 0) return;
		input.current?.focus();
		input.current?.select();
	}, [find.open, find.focus]);
	if (!find.open) return null;
	const counting = find.status === "counting";
	const none = find.status === "ready" && find.total === 0;
	const count =
		find.status === "error"
			? null
			: !find.query.trim()
				? ""
				: none
					? "0/0"
					: counting && find.hits.length === 0
						? "Counting…"
						: `${find.active >= 0 ? find.active + 1 : "…"}/${find.total}`;
	return (
		<div className="shrink-0 px-4 pt-2">
			<search
				className="mx-auto flex w-full max-w-[760px] flex-wrap items-center gap-x-1 gap-y-0.5 rounded-pool bg-surface-1 py-1 pr-1 pl-2.5"
				data-testid="find-bar"
				aria-label="Find in thread"
			>
				<Search aria-hidden className="size-3.5 shrink-0 text-text-3" />
				<input
					ref={input}
					type="search"
					value={find.query}
					maxLength={FIND_QUERY_MAX}
					onChange={(e) => find.setQuery(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === "F3") {
							e.preventDefault();
							if (e.shiftKey) find.prev();
							else find.next();
						} else if (e.key === "Escape") {
							e.preventDefault();
							onClose();
						}
					}}
					placeholder="Find in thread"
					aria-label="Find in thread"
					className="h-7 min-w-24 flex-1 bg-transparent px-1 text-body text-text-1 outline-none placeholder:text-text-3 [&::-webkit-search-cancel-button]:hidden"
					data-testid="find-input"
				/>
				<span
					className={cn(
						"shrink-0 text-meta tabular-nums",
						none ? "text-danger" : "text-text-3",
					)}
					aria-live="polite"
					data-testid="find-count"
					data-state={find.status}
				>
					{counting && <Ring className="mr-1 inline-block align-middle" />}
					{count}
				</span>
				{find.status === "error" && (
					<button
						type="button"
						onClick={find.retry}
						className="inline-flex h-7 shrink-0 items-center gap-1 rounded-control px-1.5 text-meta text-danger hover:bg-surface-3"
						data-testid="find-retry"
					>
						<RotateCw className="size-3.5" aria-hidden />
						Retry
					</button>
				)}
				<fieldset
					className="flex shrink-0 items-center max-sm:order-last max-sm:w-full"
					aria-label="Find in"
				>
					{FIND_SCOPES.map((scope) => (
						<button
							key={scope}
							type="button"
							aria-pressed={find.scope === scope}
							onClick={() => find.setScope(scope)}
							className={cn(
								"h-6 rounded-control px-1.5 text-meta transition-colors duration-(--dur-instant)",
								find.scope === scope
									? "bg-surface-3 text-text-1"
									: "text-text-3 hover:text-text-1",
							)}
							data-testid={`find-scope-${scope}`}
						>
							{SCOPE_LABEL[scope]}
						</button>
					))}
				</fieldset>
				<IconButton
					label="Match case"
					onClick={() => find.setCase(!find.caseSensitive)}
					pressed={find.caseSensitive}
					testId="find-case"
				>
					<CaseSensitive className="size-4" aria-hidden />
				</IconButton>
				<IconButton
					label="Previous match"
					keys={["Shift", "Enter"]}
					onClick={find.prev}
					disabled={find.total === 0}
				>
					<ChevronUp className="size-4" aria-hidden />
				</IconButton>
				<IconButton
					label="Next match"
					keys={["Enter"]}
					onClick={find.next}
					disabled={find.total === 0}
				>
					<ChevronDown className="size-4" aria-hidden />
				</IconButton>
				<IconButton label="Close find" keys={["Esc"]} onClick={onClose}>
					<X className="size-4" aria-hidden />
				</IconButton>
			</search>
		</div>
	);
}

function IconButton({
	label,
	keys,
	onClick,
	disabled,
	pressed,
	testId,
	children,
}: {
	label: string;
	keys?: string[];
	onClick: () => void;
	disabled?: boolean;
	pressed?: boolean;
	testId?: string;
	children: React.ReactNode;
}) {
	return (
		<Hint label={label} keys={keys}>
			<button
				type="button"
				aria-label={label}
				aria-pressed={pressed}
				onClick={onClick}
				disabled={disabled}
				className={cn(
					"inline-flex size-7 shrink-0 items-center justify-center rounded-control hover:bg-surface-3 hover:text-text-1 disabled:opacity-40",
					pressed ? "bg-surface-3 text-text-1" : "text-text-2",
				)}
				data-testid={testId}
			>
				{children}
			</button>
		</Hint>
	);
}
