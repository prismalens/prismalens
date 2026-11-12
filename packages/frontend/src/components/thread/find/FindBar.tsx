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
	X,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { Ring } from "@/components/shared/Ring";
import { cn } from "@/lib/utils";
import type { ThreadFind } from "./use-thread-find";

const SCOPE_LABEL: Record<FindScope, string> = {
	all: "All",
	mine: "Mine",
	agent: "Agent",
	tools: "Tools",
};

/** The find bar at the transcript's top right (#1101 cat 13); Escape hands focus back to the box. */
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
		<search
			className="absolute top-2 right-6 z-20 flex w-[min(420px,calc(100%-2rem))] flex-col gap-1.5 rounded-surface bg-surface-1 p-1.5 shadow-md"
			data-testid="find-bar"
			aria-label="Find in thread"
		>
			<div className="flex items-center gap-1">
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
					className="h-7 min-w-0 flex-1 rounded-control bg-surface-2 px-2 text-body text-text-1 outline-none placeholder:text-text-3 focus-visible:ring-2 focus-visible:ring-accent"
					data-testid="find-input"
				/>
				<span
					className={cn(
						"min-w-12 shrink-0 text-right text-meta tabular-nums",
						none ? "text-danger" : "text-text-2",
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
						className="inline-flex h-7 shrink-0 items-center gap-1 rounded-control px-1.5 text-meta text-danger hover:bg-surface-2"
						data-testid="find-retry"
					>
						<RotateCw className="size-3.5" aria-hidden />
						Retry
					</button>
				)}
				<IconButton
					label="Previous match"
					onClick={find.prev}
					disabled={find.total === 0}
				>
					<ChevronUp className="size-4" aria-hidden />
				</IconButton>
				<IconButton
					label="Next match"
					onClick={find.next}
					disabled={find.total === 0}
				>
					<ChevronDown className="size-4" aria-hidden />
				</IconButton>
				<IconButton label="Close find" onClick={onClose}>
					<X className="size-4" aria-hidden />
				</IconButton>
			</div>
			<div className="flex items-center gap-1">
				<fieldset className="flex items-center gap-0.5" aria-label="Find in">
					{FIND_SCOPES.map((scope) => (
						<button
							key={scope}
							type="button"
							aria-pressed={find.scope === scope}
							onClick={() => find.setScope(scope)}
							className={cn(
								"h-6 min-w-6 rounded-full px-2 text-meta transition-colors duration-(--dur-instant)",
								find.scope === scope
									? "bg-surface-3 text-text-1"
									: "text-text-2 hover:bg-surface-2",
							)}
							data-testid={`find-scope-${scope}`}
						>
							{SCOPE_LABEL[scope]}
						</button>
					))}
				</fieldset>
				<span className="flex-1" />
				<button
					type="button"
					aria-pressed={find.caseSensitive}
					aria-label="Match case"
					title="Match case"
					onClick={() => find.setCase(!find.caseSensitive)}
					className={cn(
						"inline-flex size-6 items-center justify-center rounded-control",
						find.caseSensitive
							? "bg-surface-3 text-text-1"
							: "text-text-2 hover:bg-surface-2",
					)}
					data-testid="find-case"
				>
					<CaseSensitive className="size-4" aria-hidden />
				</button>
			</div>
		</search>
	);
}

function IconButton({
	label,
	onClick,
	disabled,
	children,
}: {
	label: string;
	onClick: () => void;
	disabled?: boolean;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			onClick={onClick}
			disabled={disabled}
			className="inline-flex size-7 shrink-0 items-center justify-center rounded-control text-text-2 hover:bg-surface-2 hover:text-text-1 disabled:opacity-40"
		>
			{children}
		</button>
	);
}
