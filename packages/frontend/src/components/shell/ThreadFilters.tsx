// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ThreadSection } from "@prismalens/contracts";
import { ListFilter } from "lucide-react";
import {
	createContext,
	type ReactNode,
	useContext,
	useMemo,
	useState,
} from "react";
import { Hint } from "@/components/shared/Hint";
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
import { useRepositories } from "@/lib/api/hooks";
import type { ThreadFeedInput } from "@/lib/api/hooks/use-threads-orpc";
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

const Filters = createContext<{
	filters: ThreadFilterState;
	setFilters: (next: ThreadFilterState) => void;
}>({ filters: {}, setFilters: () => {} });

/** The sidebar list's filters, for the whole shell (#1020): the Filter button sets them, the list reads them. */
export function ThreadFiltersHost({ children }: { children: ReactNode }) {
	const [filters, setFilters] = useState<ThreadFilterState>({});
	const value = useMemo(() => ({ filters, setFilters }), [filters]);
	return <Filters.Provider value={value}>{children}</Filters.Provider>;
}

export function useThreadFilters() {
	const { filters } = useContext(Filters);
	return useMemo(() => feedInput(filters), [filters]);
}

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

/** The Filter icon beside Search (#1020, redesign §2): Kind, State, Project and Time narrow the list. */
export function ThreadFilterButton({ className }: { className?: string }) {
	const { filters, setFilters } = useContext(Filters);
	const [open, setOpen] = useState(false);
	const repos = useRepositories({ limit: 100, enabled: open });
	const count = filterCount(filters);
	const set = (next: Partial<ThreadFilterState>) =>
		setFilters({ ...filters, ...next });
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<Hint label="Filter" side="bottom">
				<PopoverTrigger asChild>
					<button
						type="button"
						aria-label={count ? `Filter, ${count} on` : "Filter"}
						className={cn(
							"relative",
							className,
							count > 0 && "bg-surface-3 text-text-1",
						)}
						data-testid="sidebar-filter"
						data-count={count || undefined}
					>
						<ListFilter className="size-4 shrink-0 stroke-[1.5]" />
					</button>
				</PopoverTrigger>
			</Hint>
			<PopoverContent
				align="start"
				side="bottom"
				className="grid w-64 gap-1.5 rounded-surface p-2"
				data-testid="thread-filters"
			>
				<Filter
					label="Kind"
					value={filters.kind}
					onChange={(v) => set({ kind: v as Kind | undefined })}
					options={[
						["chat", "Threads"],
						["investigation", "Reports"],
					]}
				/>
				<Filter
					label="State"
					value={filters.section}
					onChange={(v) => set({ section: v as ThreadSection | undefined })}
					options={[
						["needs", "Needs you"],
						["active", "Active"],
						["settled", "Settled"],
					]}
				/>
				<Filter
					label="Project"
					value={filters.repositoryId}
					onChange={(v) => set({ repositoryId: v })}
					options={projectOptions(repos.data?.data ?? [], filters.repositoryId)}
				/>
				<Filter
					label="Time"
					value={filters.since}
					onChange={(v) =>
						set({
							since: v as Since | undefined,
							sinceAt: v ? Date.now() : undefined,
						})
					}
					options={[
						["1d", "Past day"],
						["7d", "Past week"],
						["30d", "Past month"],
					]}
				/>
				{count > 0 && (
					<Button
						variant="text"
						size="sm"
						className="justify-self-start"
						onClick={() => setFilters({})}
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
}: {
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
