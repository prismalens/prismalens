// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { RecordedHypothesis } from "@prismalens/contracts";
import { Crosshair, FileDiff, FolderTree, Globe, X } from "lucide-react";
import type { KeyboardEvent } from "react";
import { BrowserTab } from "@/components/run/BrowserTab";
import {
	type EvidenceFiles,
	FilesPane,
} from "@/components/run/RunDetailsPanel";
import { Hint } from "@/components/shared/Hint";
import { Empty } from "@/components/shared/State";
import { Button } from "@/components/ui/button";
import { statusWord } from "@/lib/spine";
import { cn } from "@/lib/utils";
import { WorktreeDiff } from "./WorktreeDiff";

export type Surface = "files" | "diff" | "suspects" | "browser";

const SURFACES = [
	{ id: "files", label: "Files", Icon: FolderTree },
	{ id: "diff", label: "Diff", Icon: FileDiff },
	{ id: "suspects", label: "Suspects", Icon: Crosshair },
	{ id: "browser", label: "Browser", Icon: Globe },
] as const;

/**
 * A thread's right panel (#1020): icon tabs for Files, Diff, Suspects (investigations
 * only) and Browser. It opens only when you open it, on no surface until you pick one.
 */
export function ThreadPanel({
	surface,
	onSurface,
	onClose,
	runId,
	live,
	investigation,
	diff = true,
	files,
	suspects,
}: {
	surface: Surface | null;
	onSurface: (s: Surface) => void;
	onClose: () => void;
	runId: string;
	live: boolean;
	investigation: boolean;
	/** False for a plain folder's thread: no diff base, so no Diff (#1020). */
	diff?: boolean;
	files: EvidenceFiles;
	/** In the order the agent first recorded them; each at its latest status. */
	suspects: RecordedHypothesis[];
}) {
	const shown = SURFACES.filter(
		(s) => (investigation || s.id !== "suspects") && (diff || s.id !== "diff"),
	);
	const onKeyDown = (e: KeyboardEvent) => {
		if (e.key !== "Escape" || e.defaultPrevented) return;
		e.stopPropagation();
		onClose();
	};
	return (
		<div
			id="thread-panel"
			onKeyDown={onKeyDown}
			className="flex h-full min-h-0 flex-col"
			data-testid="thread-panel"
		>
			<div
				role="tablist"
				aria-label="Surfaces"
				data-title-row
				className="flex h-(--header-h) shrink-0 items-center gap-1 px-2 shadow-[0_1px_0_var(--hairline)]"
			>
				{shown.map(({ id, label, Icon }) => (
					<Hint key={id} label={label}>
						<button
							type="button"
							role="tab"
							aria-selected={surface === id}
							aria-label={label}
							onClick={() => onSurface(id)}
							className={cn(
								"flex size-7 items-center justify-center rounded-control transition-colors duration-(--dur-instant) hover:bg-surface-3",
								surface === id ? "bg-surface-3 text-text-1" : "text-text-2",
							)}
							data-testid={`surface-${id}`}
						>
							<Icon className="size-4" aria-hidden />
						</button>
					</Hint>
				))}
				<span className="flex-1" />
				<Button
					variant="text"
					size="icon"
					aria-label="Close panel"
					onClick={onClose}
					className="text-text-3"
					data-testid="thread-panel-close"
				>
					<X className="size-3.5" />
				</Button>
			</div>
			<div role="tabpanel" className="flex min-h-0 flex-1 flex-col">
				{surface === null ||
				(surface === "diff" && !diff) ||
				(surface === "suspects" && !investigation) ? (
					<Empty
						className="justify-center px-3 pt-8"
						text="Open a surface"
						testId="surface-empty"
					/>
				) : surface === "files" ? (
					<FilesPane files={files} onJump={() => {}} />
				) : surface === "diff" ? (
					<WorktreeDiff runId={runId} live={live} />
				) : surface === "suspects" ? (
					<Suspects suspects={suspects} />
				) : (
					<BrowserTab links={files.links} />
				)}
			</div>
		</div>
	);
}

/** The agent's suspects in its own order, each with its own status word; no ranking is added. */
function Suspects({ suspects }: { suspects: RecordedHypothesis[] }) {
	if (suspects.length === 0)
		return (
			<Empty className="px-3" text="No suspects yet" testId="suspects-empty" />
		);
	return (
		<ol
			className="m-0 flex min-h-0 list-none flex-col gap-2 overflow-y-auto px-3 py-3"
			data-testid="suspects"
		>
			{suspects.map((h) => (
				<li
					key={h.id}
					className="flex flex-col gap-0.5 rounded-surface bg-surface-1 px-3 py-2"
					data-testid="suspect"
				>
					<span
						className={cn(
							"text-meta",
							h.status === "refuted" ? "text-text-3" : "text-accent",
						)}
						data-testid="suspect-status"
					>
						{statusWord(h.status)}
					</span>
					<span dir="auto" className="[overflow-wrap:anywhere] text-text-1">
						{h.statement}
					</span>
				</li>
			))}
		</ol>
	);
}
