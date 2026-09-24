// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { Mono } from "@/components/shared/Mono";
import { StateWord } from "@/components/shared/StateChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { useUpdateHarnessSettings } from "@/lib/api/hooks";
import { AgentPicker, useAgentChoice } from "./AgentPicker";

/** The model pill: the id the next run asks for, or the agent's own default. */
function ModelPill() {
	const { effective, model } = useAgentChoice();
	const update = useUpdateHarnessSettings();
	const [open, setOpen] = useState(false);
	const [draft, setDraft] = useState(model);
	useEffect(() => setDraft(model), [model]);
	const ignored = effective?.modelVia === "unsupported";
	const shown = model || effective?.defaultModel || "agent default";
	const suggestions = effective?.models;
	const typed = draft.trim();
	const match = suggestions?.entries.find((m) => m.id === typed);
	const listName =
		suggestions?.source === "harness"
			? `${effective?.label}'s own list`
			: `the model catalogue of ${suggestions?.asOf.slice(0, 10)}`;

	const choose = (id: string | undefined) => {
		if (!effective) return;
		update.mutate({ models: { [effective.id]: id ?? null } });
		setOpen(false);
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					className="h-7 gap-1 px-2 text-record"
					// A model stored for a harness that cannot take one blocks the run; the
					// pill stays open for it so it can be cleared.
					disabled={ignored && !model}
					title={
						ignored
							? model
								? `${effective?.label} cannot take a model; clear it to run`
								: `${effective?.label} uses its own model`
							: undefined
					}
					data-testid="model-pill"
				>
					<Mono className="max-w-40 truncate">{shown}</Mono>
					<ChevronDown className="h-3 w-3 text-muted-foreground" />
				</Button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-72 space-y-2 p-3">
				<p className="text-meta text-muted-foreground">
					Model id in the agent's own format. Empty means{" "}
					{effective?.defaultModel ? (
						<Mono>{effective.defaultModel}</Mono>
					) : (
						"the agent's default"
					)}
					.
				</p>
				<form
					className="flex gap-2"
					onSubmit={(e) => {
						e.preventDefault();
						choose(typed || undefined);
					}}
				>
					<Input
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
						placeholder={effective?.defaultModel ?? "agent default"}
						className="h-8 font-mono text-record"
						aria-label="Model"
					/>
					<Button
						type="submit"
						size="sm"
						className="h-8"
						disabled={update.isPending}
					>
						Use
					</Button>
				</form>
				{typed && suggestions && suggestions.entries.length > 0 && (
					<p
						className="text-meta text-muted-foreground"
						data-testid="model-note"
					>
						{match
							? match.status && match.status !== "current"
								? `Marked ${match.status} in ${listName}.`
								: `In ${listName}.`
							: `Not in ${listName}; sent as typed.`}
					</p>
				)}
				{suggestions && suggestions.entries.length > 0 && (
					<ul
						className="max-h-48 space-y-0.5 overflow-y-auto border-t pt-2"
						aria-label="Suggested models"
						data-testid="model-suggestions"
					>
						{suggestions.entries.map((m) => (
							<li key={m.id}>
								<button
									type="button"
									className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-record hover:bg-muted"
									onClick={() => choose(m.id)}
								>
									<span className="min-w-0 flex-1 truncate">{m.name}</span>
									{m.status && m.status !== "current" && (
										<StateWord tone="stale">{m.status}</StateWord>
									)}
									<Mono className="max-w-32 truncate text-meta text-muted-foreground">
										{m.id}
									</Mono>
								</button>
							</li>
						))}
					</ul>
				)}
			</PopoverContent>
		</Popover>
	);
}

/**
 * The strip under the composer input: which agent and model the next run uses.
 * The same choices live in Settings; this is where they are made at the moment
 * of use.
 */
export function RunToolbar() {
	return (
		<div
			className="flex flex-wrap items-center gap-1"
			data-testid="run-toolbar"
		>
			<AgentPicker />
			<span className="h-4 w-px bg-border" aria-hidden />
			<ModelPill />
		</div>
	);
}
