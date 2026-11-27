// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ThreadSection } from "@prismalens/contracts";
import { PR_TONES } from "@prismalens/contracts";
import { ListFilter } from "lucide-react";
import { useEffect, useState } from "react";
import { type FactId, fact } from "@/components/kit/fact";
import { statusWord } from "@/components/kit/Status";
import {
	FilterTrigger,
	type ListFilterParams,
} from "@/components/shell/ThreadFilterTrigger";
import { PR_TONE_WORD } from "@/components/thread/panel/PullRequests";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import type { ThreadFeedInput } from "@/lib/api/hooks/use-threads-orpc";
import { FILTER_STATES } from "@/lib/thread-filter";
import { cn } from "@/lib/utils";

type Kind = "chat" | "investigation";
type Since = "1d" | "7d" | "30d";
const SINCE_MS: Record<Since, number> = {
	"1d": 86_400_000,
	"7d": 7 * 86_400_000,
	"30d": 30 * 86_400_000,
};

export interface ThreadFilterState {
	kind?: Kind;
	section?: ThreadSection;
	repositoryId?: string;
	since?: Since;
	/** When the Time filter was picked: the window starts from then, so the query key holds still. */
	sinceAt?: number;
}

/** The feed query the sidebar list asks for under these filters. */
export function feedInput(f: ThreadFilterState): ThreadFeedInput {
	return {
		...(f.kind ? { kind: f.kind } : {}),
		...(f.section ? { section: f.section } : {}),
		...(f.repositoryId ? { repositoryId: f.repositoryId } : {}),
		...(f.since && f.sinceAt
			? { since: new Date(f.sinceAt - SINCE_MS[f.since]) }
			: {}),
	};
}

export const filterCount = (f: ThreadFilterState) =>
	[f.kind, f.section, f.repositoryId, f.since].filter(Boolean).length;

const ANY = "any";

/** The Project choices; a picked project past the loaded page stays visible, labelled. */
export function projectOptions(
	repos: readonly { id: string; fullName: string }[],
	selected: string | undefined,
): Array<[string, string]> {
	const options = repos.map((r): [string, string] => [r.id, r.fullName]);
	return selected && !repos.some((r) => r.id === selected)
		? [[selected, "Selected project"], ...options]
		: options;
}

const STATE_OPTIONS: Array<[string, string]> = FILTER_STATES.map((s) => [
	s,
	s === "needs" ? "Needs you" : statusWord(s),
]);
const PR_OPTIONS: Array<[string, string]> = PR_TONES.map((t) => [
	t,
	PR_TONE_WORD[t],
]);

/** The Filter popover on the Threads heading: State and PR, written to the URL. */
export function ThreadFilterButton({
	value,
	onChange,
	takeOpen,
}: {
	value: ListFilterParams;
	onChange: (next: ListFilterParams) => void;
	/** True once if its stand-in was clicked while this code loaded. */
	takeOpen?: () => boolean;
}) {
	const [open, setOpen] = useState(false);
	// Read after commit: a click on the stand-in up to then still opens it (bar 1.7).
	useEffect(() => {
		if (takeOpen?.()) setOpen(true);
	}, [takeOpen]);
	const count = [value.state, value.pr].filter(Boolean).length;
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<FilterTrigger count={count} />
			</PopoverTrigger>
			<PopoverContent
				align="end"
				side="bottom"
				className="grid w-56 gap-1.5 rounded-surface p-2"
				data-testid="thread-filters"
			>
				<Filter
					label="State"
					value={value.state}
					onChange={(v) => onChange({ ...value, state: v })}
					options={STATE_OPTIONS}
					fact="status"
				/>
				<Filter
					label="PR"
					value={value.pr}
					onChange={(v) => onChange({ ...value, pr: v })}
					options={PR_OPTIONS}
				/>
				{count > 0 && (
					<Button
						variant="text"
						size="sm"
						className="justify-self-start"
						onClick={() => onChange({})}
						data-testid="thread-filters-clear"
					>
						Clear
					</Button>
				)}
			</PopoverContent>
		</Popover>
	);
}

function Filter({
	label,
	value,
	onChange,
	options,
	fact: shows,
}: {
	/** The fact the picked value names (one fact, one place). */
	fact?: FactId;
	label: string;
	value: string | undefined;
	onChange: (v: string | undefined) => void;
	options: Array<[string, string]>;
}) {
	const id = label.toLowerCase();
	return (
		<Select
			value={value ?? ANY}
			onValueChange={(v) => onChange(v === ANY ? undefined : v)}
		>
			<SelectTrigger
				aria-label={label}
				className="w-full text-meta"
				data-testid={`thread-filter-${id}`}
				{...(shows ? fact(shows) : {})}
			>
				<span className="text-text-3">{label}</span>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				<SelectItem value={ANY}>Any</SelectItem>
				{options.map(([v, l]) => (
					<SelectItem
						key={v}
						value={v}
						data-testid={`thread-filter-${id}-${v}`}
					>
						{l}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
