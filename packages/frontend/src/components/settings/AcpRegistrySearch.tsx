// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	ACP_REGISTRY,
	type AcpRegistryEntry,
} from "@prismalens/config/acp-registry";
import { HARNESS_REGISTRY } from "@prismalens/config/harness";
import { CircleDashed, Search } from "lucide-react";
import { useId, useState } from "react";
import { CommandChip } from "@/components/ui/command-chip";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Registry entries that are not already one of Add agent's tiles (#911). */
export const OTHER_AGENTS: readonly AcpRegistryEntry[] = (() => {
	const tiles = new Set(
		Object.values(HARNESS_REGISTRY).flatMap((d) => d.acpRegistryIds ?? []),
	);
	return ACP_REGISTRY.filter((e) => !tiles.has(e.id));
})();

/** Up to `limit` entries whose name, id or description holds every word of the query. */
export function searchRegistry(
	query: string,
	entries: readonly AcpRegistryEntry[] = OTHER_AGENTS,
	limit = 8,
): AcpRegistryEntry[] {
	const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
	if (!words.length) return [];
	return entries
		.filter((e) => {
			const hay = `${e.name} ${e.id} ${e.description}`.toLowerCase();
			return words.every((w) => hay.includes(w));
		})
		.slice(0, limit);
}

/**
 * "Or find one in the ACP registry" (#848): a search over the registry list
 * bundled with this release. PrismaLens fetches and installs nothing (ADR
 * 0003 §4); choosing an entry shows its install line to copy. It sits under
 * Add agent's tiles and leaves out the agents those tiles already are (#911).
 */
export function AcpRegistrySearch({
	entries = OTHER_AGENTS,
}: {
	entries?: readonly AcpRegistryEntry[];
}) {
	const [query, setQuery] = useState("");
	const [chosen, setChosen] = useState<string | null>(null);
	const id = useId();
	const found = searchRegistry(query, entries);
	return (
		<div className="flex flex-col gap-2" data-testid="acp-registry">
			<label htmlFor={id} className="text-body font-medium">
				Or find one in the ACP registry
			</label>
			<div className="flex h-9 items-center gap-2 rounded-control bg-well-in-pool px-2.5">
				<Search className="size-4 shrink-0 text-text-3" aria-hidden />
				<Input
					id={id}
					value={query}
					onChange={(e) => {
						setQuery(e.target.value);
						setChosen(null);
					}}
					placeholder={`Search ${entries.length} agents`}
					className="h-8 flex-1 bg-transparent px-0"
					data-testid="acp-registry-search"
				/>
			</div>
			{query.trim() && found.length === 0 && (
				<p className="text-meta text-text-2">No agent in the list matches.</p>
			)}
			{found.length > 0 && (
				<ul className="flex flex-col gap-1" aria-label="Registry agents">
					{found.map((e) => {
						const on = chosen === e.id;
						return (
							<li key={e.id}>
								<button
									type="button"
									aria-expanded={on}
									onClick={() => setChosen(on ? null : e.id)}
									className={cn(
										"flex min-h-12 w-full items-start gap-3 rounded-control px-2.5 py-2 text-left transition-colors duration-(--dur-instant) hover:bg-surface-3",
										on && "bg-surface-3",
									)}
									data-testid="acp-registry-entry"
								>
									<span className="min-w-0 flex-1">
										<span className="block font-semibold">{e.name}</span>
										<span className="line-clamp-2 text-meta text-text-2">
											{e.description}
										</span>
									</span>
									<span className="inline-flex shrink-0 items-center gap-1 text-meta text-text-2">
										<CircleDashed className="size-3.5" aria-hidden />
										Not installed
									</span>
								</button>
								{on && (
									<div className="mt-1 mb-2 flex flex-col gap-1.5 pl-2.5">
										{e.install.map((line) => (
											<CommandChip
												key={line}
												command={line}
												testId="acp-registry-install"
											/>
										))}
									</div>
								)}
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}
