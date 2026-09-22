// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { HARNESS_REGISTRY } from "@prismalens/config/harness";
import type { HarnessSetting, HarnessStatus } from "@prismalens/contracts";
import { Check, ChevronDown, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Mono } from "@/components/shared/Mono";
import { StateWord } from "@/components/shared/StateChip";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	useHarnesses,
	useHarnessSettings,
	useUpdateHarnessSettings,
} from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

interface Choice {
	value: HarnessSetting;
	name: string;
	/** One line under the name: what choosing it means right now. */
	line: React.ReactNode;
	disabled: boolean;
	status?: HarnessStatus;
}

function Kbd({ children }: { children: string }) {
	return (
		<kbd className="inline-flex h-4 min-w-4 items-center justify-center rounded border bg-muted px-1 font-mono text-[10px] text-foreground">
			{children}
		</kbd>
	);
}

/** What the current setting resolves to, for the pill and for the rail. */
export function useAgentChoice() {
	const harnessesQuery = useHarnesses();
	const settingsQuery = useHarnessSettings();
	const harnesses = harnessesQuery.data?.harnesses ?? [];
	const selection = harnessesQuery.data?.selection;
	const setting: HarnessSetting = settingsQuery.data?.harness ?? "auto";
	const effectiveId = setting === "auto" ? selection?.harness : setting;
	const effective = harnesses.find((h) => h.id === effectiveId);
	const fidelity =
		effective && effective.id in HARNESS_REGISTRY
			? HARNESS_REGISTRY[effective.id as keyof typeof HARNESS_REGISTRY]
					.readOnlyFidelity
			: undefined;
	return {
		harnesses,
		selection,
		setting,
		effective,
		fidelity,
		model: settingsQuery.data?.model ?? "",
		isLoading: harnessesQuery.isLoading || settingsQuery.isLoading,
		isError: harnessesQuery.isError,
	};
}

/**
 * The agent picker: a pill that says which coding agent the next run uses, and
 * a two-line list to change it. Choosing saves at once; there is no separate
 * save. The same control sits in the composer and in Settings.
 */
export function AgentPicker({
	className,
	align = "start",
}: {
	className?: string;
	align?: "start" | "end";
}) {
	const { harnesses, selection, setting, effective, isLoading } =
		useAgentChoice();
	const update = useUpdateHarnessSettings();
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [cursor, setCursor] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);

	const choices: Choice[] = useMemo(() => {
		const auto: Choice = {
			value: "auto",
			name: "Auto",
			line: selection?.harness
				? `first verified on PATH · now ${harnesses.find((h) => h.id === selection.harness)?.label ?? selection.harness}`
				: "first verified agent found on PATH",
			disabled: false,
		};
		const rest: Choice[] = harnesses.map((h) => ({
			value: h.id as HarnessSetting,
			name: h.label,
			status: h,
			disabled: !h.installed,
			line: h.installed ? (
				<>
					<Mono>{h.binary}</Mono>
					{h.admission ? (
						<StateWord tone="done">verified {h.admission.version}</StateWord>
					) : (
						<StateWord tone="stale">not verified</StateWord>
					)}
				</>
			) : (
				<>
					<StateWord tone="neutral">not installed</StateWord>
					<Mono className="truncate">{h.install}</Mono>
				</>
			),
		}));
		const all = [auto, ...rest];
		const q = query.trim().toLowerCase();
		return q
			? all.filter(
					(c) =>
						c.name.toLowerCase().includes(q) ||
						c.status?.binary.toLowerCase().includes(q),
				)
			: all;
	}, [harnesses, selection, query]);

	useEffect(() => {
		if (open) {
			setQuery("");
			setCursor(
				Math.max(
					0,
					choices.findIndex((c) => c.value === setting),
				),
			);
			setTimeout(() => inputRef.current?.focus(), 0);
		}
		// Only when the popover opens.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open]);

	const choose = (c: Choice) => {
		if (c.disabled) return;
		update.mutate({ harness: c.value });
		setOpen(false);
	};

	const label = isLoading
		? "…"
		: effective
			? `${effective.label}${effective.admission?.version ? ` ${effective.admission.version}` : ""}`
			: "No agent";
	const tone = effective ? (selection?.runnable ? "done" : "watch") : "failed";

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					className={cn("h-7 gap-1.5 px-2 text-record", className)}
					data-testid="agent-picker"
					aria-label="Investigation agent"
				>
					<Sparkles
						className="h-3.5 w-3.5"
						style={{
							color: `var(--run-${tone === "done" ? "done" : tone === "watch" ? "active" : "failed"})`,
						}}
					/>
					<span className="max-w-40 truncate">{label}</span>
					{setting === "auto" && effective && (
						<span className="text-meta text-muted-foreground">auto</span>
					)}
					<ChevronDown className="h-3 w-3 text-muted-foreground" />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align={align}
				className="w-80 p-0"
				data-testid="agent-picker-list"
			>
				<input
					ref={inputRef}
					value={query}
					onChange={(e) => {
						setQuery(e.target.value);
						setCursor(0);
					}}
					onKeyDown={(e) => {
						if (e.key === "ArrowDown") {
							e.preventDefault();
							setCursor((c) => Math.min(choices.length - 1, c + 1));
						} else if (e.key === "ArrowUp") {
							e.preventDefault();
							setCursor((c) => Math.max(0, c - 1));
						} else if (e.key === "Enter") {
							e.preventDefault();
							const c = choices[cursor];
							if (c) choose(c);
						}
					}}
					placeholder="Search agents"
					aria-label="Search agents"
					className="h-9 w-full border-b bg-transparent px-3 text-record outline-none placeholder:text-muted-foreground"
				/>
				<div role="listbox" className="max-h-72 overflow-y-auto py-1">
					{choices.map((c, i) => {
						const active = c.value === setting;
						return (
							<div
								key={c.value}
								role="option"
								tabIndex={-1}
								aria-selected={active}
								aria-disabled={c.disabled}
								data-testid={`agent-option-${c.value}`}
								onMouseEnter={() => setCursor(i)}
								onMouseDown={(e) => {
									e.preventDefault();
									choose(c);
								}}
								className={cn(
									"flex cursor-pointer items-start gap-2 px-3 py-1.5",
									i === cursor && "bg-muted",
									c.disabled && "cursor-not-allowed opacity-60",
								)}
							>
								<span className="mt-1 flex h-3.5 w-3.5 shrink-0 items-center justify-center">
									{active && <Check className="h-3.5 w-3.5 text-primary" />}
								</span>
								<span className="min-w-0 flex-1">
									<span className="block truncate text-record font-medium">
										{c.name}
									</span>
									<span className="flex items-center gap-2 text-meta text-muted-foreground">
										{c.line}
									</span>
								</span>
							</div>
						);
					})}
					{choices.length === 0 && (
						<p className="px-3 py-2 text-record text-muted-foreground">
							No agent matches.
						</p>
					)}
				</div>
				<div className="flex items-center gap-3 border-t px-3 py-1.5 text-meta text-muted-foreground">
					<span className="flex items-center gap-1">
						<Kbd>↑</Kbd>
						<Kbd>↓</Kbd> move
					</span>
					<span className="flex items-center gap-1">
						<Kbd>↵</Kbd> choose
					</span>
					<span className="flex items-center gap-1">
						<Kbd>esc</Kbd> close
					</span>
				</div>
			</PopoverContent>
		</Popover>
	);
}
