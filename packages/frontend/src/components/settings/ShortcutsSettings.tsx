// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useEffect, useState } from "react";
import { Pool } from "@/components/shared/Row";
import { SettingGroup, SettingRow } from "@/components/shared/SettingRow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listenKeys } from "@/hooks/use-global-shortcuts";
import { useRemapShortcut, useShortcutRows } from "@/hooks/use-shortcuts";
import {
	comboFromEvent,
	keyCaps,
	parseKeys,
	type Shortcut,
	takenBy,
} from "@/lib/shortcuts";

const GROUPS: Shortcut["group"][] = ["App", "Go to", "Thread", "Message box"];

/** Settings → Keyboard shortcuts (#1101 cat 18): every key the app reads, searchable, remappable. */
export function ShortcutsSettings() {
	const rows = useShortcutRows();
	const [query, setQuery] = useState("");
	const q = query.trim().toLowerCase();
	const shown = rows.filter(
		(r) =>
			!q ||
			r.label.toLowerCase().includes(q) ||
			r.current.toLowerCase().includes(q),
	);
	return (
		<div data-testid="shortcuts-settings">
			<Input
				type="search"
				value={query}
				onChange={(e) => setQuery(e.target.value)}
				placeholder="Search shortcuts"
				aria-label="Search shortcuts"
				className="mb-6"
				data-testid="shortcuts-search"
			/>
			{shown.length === 0 && (
				<p className="text-body text-text-2" data-testid="shortcuts-none">
					No shortcut matches.
				</p>
			)}
			{GROUPS.map((group) => {
				const inGroup = shown.filter((r) => r.group === group);
				if (!inGroup.length) return null;
				return (
					<SettingGroup key={group} title={group} testId={`shortcuts-${group}`}>
						<Pool>
							{inGroup.map((row) => (
								<ShortcutRow key={row.id} row={row} />
							))}
						</Pool>
					</SettingGroup>
				);
			})}
		</div>
	);
}

function ShortcutRow({
	row,
}: {
	row: ReturnType<typeof useShortcutRows>[number];
}) {
	const remap = useRemapShortcut();
	const { mutate } = remap;
	const [recording, setRecording] = useState(false);
	const [problem, setProblem] = useState<string | null>(null);

	useEffect(() => {
		if (!recording) return;
		const onKey = (e: KeyboardEvent) => {
			e.preventDefault();
			e.stopPropagation();
			if (e.key === "Escape") {
				setRecording(false);
				setProblem(null);
				return;
			}
			const combo = comboFromEvent(e);
			if (!combo) return;
			const keys = row.chordPrefix ? `${row.chordPrefix} ${combo}` : combo;
			if (!parseKeys(keys)) return;
			const other = takenBy(keys, row.id);
			if (other) {
				setProblem(`${keys} already does ${other.label}. Try another key.`);
				return;
			}
			setProblem(null);
			setRecording(false);
			mutate({ id: row.id, keys });
		};
		// Capture, so the app's own handlers never act on the key being recorded.
		return listenKeys(onKey, { capture: true });
	}, [recording, row.id, row.chordPrefix, mutate]);

	return (
		<SettingRow
			label={row.label}
			description={
				row.fixed
					? "Fixed: it belongs to the box or list it works in"
					: recording
						? row.chordPrefix
							? `Press the key after ${row.chordPrefix}. Esc cancels.`
							: "Press the new keys. Esc cancels."
						: row.changed
							? "Remapped"
							: "Default"
			}
			testId={`shortcut-${row.id}`}
			changed={row.changed}
			onReset={() => remap.mutate({ id: row.id, keys: null })}
			below={
				problem && (
					<p className="text-meta text-danger" role="alert">
						{problem}
					</p>
				)
			}
		>
			<Keys keys={row.current} />
			{!row.fixed && (
				<Button
					variant="secondary"
					size="sm"
					aria-pressed={recording}
					onClick={() => {
						setProblem(null);
						setRecording((r) => !r);
					}}
					data-testid={`shortcut-${row.id}-remap`}
				>
					{recording ? "Recording" : "Remap"}
				</Button>
			)}
		</SettingRow>
	);
}

export function Keys({ keys }: { keys: string }) {
	return (
		<span className="inline-flex items-center gap-1">
			{keyCaps(keys).map((step, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: a chord may repeat a step.
				<span key={i} className="inline-flex items-center gap-0.5">
					{step.map((k) => (
						<kbd
							key={k}
							className="inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] bg-surface-3 px-1 font-mono text-meta text-text-2"
						>
							{k}
						</kbd>
					))}
				</span>
			))}
		</span>
	);
}
