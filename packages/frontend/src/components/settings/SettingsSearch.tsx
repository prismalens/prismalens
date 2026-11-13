// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { Pool, Row } from "@/components/shared/Row";
import { Input } from "@/components/ui/input";
import { SETTINGS_SECTIONS, type SettingsTab } from "./SettingsFrame";
import { searchSettings } from "./settings-search";

/** The search kept in the URL (`?q=`), so a result's Back returns to the list. */
export function useSettingsQuery(): string {
	return useSearch({ strict: false, select: (s) => s.q ?? "" }) as string;
}

/** Search across Settings (#1101 cat 18), above the page list and on the phone's landing. */
export function SettingsSearchBox({ query }: { query: string }) {
	const navigate = useNavigate();
	const tab = useSearch({ strict: false, select: (s) => s.tab }) as
		| SettingsTab
		| undefined;
	return (
		<Input
			type="search"
			value={query}
			onChange={(e) =>
				void navigate({
					to: "/settings",
					search: { tab, q: e.target.value || undefined },
					replace: true,
				})
			}
			placeholder="Search settings"
			aria-label="Search settings"
			className="mb-3"
			data-testid="settings-search"
		/>
	);
}

/** Every row the query finds: its name, one sentence, and the page it lives on. */
export function SettingsResults({ query }: { query: string }) {
	const found = searchSettings(query);
	// Read here, not at module load: SettingsFrame imports this file too.
	const page = new Map(SETTINGS_SECTIONS.map((s) => [s.tab, s.label]));
	return (
		<div data-testid="settings-results">
			<h2 className="mb-4 text-display">Results</h2>
			{found.length === 0 ? (
				<p className="text-body text-text-2" data-testid="settings-no-results">
					No setting matches.
				</p>
			) : (
				<Pool>
					{found.map((s) => (
						<Row
							key={`${s.tab}-${s.anchor ?? s.name}`}
							className="relative"
							testId="settings-result"
							label={
								<Link
									to="/settings"
									search={{ tab: s.tab }}
									hash={s.anchor}
									className="after:absolute after:inset-0"
								>
									{s.name}
								</Link>
							}
							meta={s.sentence}
							trailing={
								<span className="flex items-center gap-1 text-meta text-text-3">
									{page.get(s.tab)}
									<ChevronRight className="size-4" aria-hidden />
								</span>
							}
						/>
					))}
				</Pool>
			)}
		</div>
	);
}
