// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, FolderOpen } from "lucide-react";
import type { MenuEntry } from "@/components/kit/Menu";
import { entryOf, surfaceEntries } from "@/components/kit/registry";
import { SurfaceMore } from "@/components/kit/Surface";
import { Hint } from "@/components/shared/Hint";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { orpc } from "@/lib/api/orpc-client";
import { cn } from "@/lib/utils";
import type { DetailsCtx, EditorChoice } from "./details.actions";
import type { GitAction } from "./git-action";

const VARIANT: Record<GitAction, "primary" | "secondary" | "danger-fill"> = {
	push: "primary",
	createPr: "primary",
	markReady: "primary",
	fixChecks: "danger-fill",
	resolveConflicts: "danger-fill",
	restoreBranch: "primary",
	reread: "primary",
	viewPr: "secondary",
	branchAndPush: "primary",
};

type Row = Exclude<MenuEntry, { separator: true }>;
const row = (e: MenuEntry | null): Row | null =>
	e && !("separator" in e) ? e : null;

const SPLIT =
	"flex h-6 items-center justify-center text-text-2 outline-none hover:bg-surface-3 hover:text-text-1 focus-visible:ring-2 focus-visible:ring-accent data-[state=open]:bg-surface-3";

/** The card's one git action, run from its registered id (#1125); the box's next-step slot. */
export function DetailsActions({
	ctx,
	primary,
}: {
	ctx: DetailsCtx;
	primary: GitAction | null;
}) {
	const action = primary ? row(entryOf(`details.${primary}`, ctx)) : null;
	if (!action || !primary) return null;
	return (
		<div className="flex min-h-7 items-center px-2">
			<Button
				size="xs"
				variant={VARIANT[primary]}
				onClick={action.onSelect}
				data-testid="details-git-action"
				data-action={primary}
			>
				{action.icon && <action.icon aria-hidden />}
				{action.label}
			</Button>
		</div>
	);
}

/** The computer's own file manager, by its name there. */
const FILES_WORD = {
	windows: "File Explorer",
	macos: "Finder",
	linux: "Files",
	other: "Files",
} as const;

/** The split's choices: the editors on the host's PATH, its file manager, and the saved default. */
function useOpenWith(
	ctx: DetailsCtx,
	opener: NonNullable<DetailsCtx["opener"]>,
): DetailsCtx {
	const editors = useQuery({
		...orpc.settings.editors.list.queryOptions({ input: {} }),
		staleTime: 60_000,
	}).data?.editors;
	const key = orpc.settings.threadContext.get.queryKey({ input: {} });
	const settings = useQuery({
		...orpc.settings.threadContext.get.queryOptions({ input: {} }),
	}).data;
	const queryClient = useQueryClient();
	const installed = new Map(editors?.map((e) => [e.id, e.label]) ?? []);
	const saved = settings?.editor;
	const current: EditorChoice =
		saved && saved !== "system" && installed.has(saved) ? saved : "system";
	const label = (e: EditorChoice) =>
		e === "system" ? FILES_WORD[opener.os] : (installed.get(e) ?? e);
	const openIn = (e: EditorChoice) => {
		opener.open(e);
		// Only the owner's pick becomes the default; the route replaces the whole record.
		if (opener.owner && settings && e !== current)
			void orpc.settings.threadContext.update
				.call({ ...settings, editor: e })
				.then((next) => queryClient.setQueryData(key, next))
				.catch(() => toast({ title: "The default did not change" }));
	};
	return {
		...ctx,
		openFolder: () => openIn(current),
		editor: { current, label },
		openIn,
		facts: {
			...ctx.facts,
			is: {
				...ctx.facts.is,
				notOwner: !opener.owner,
				...Object.fromEntries(
					(editors ?? []).map((e) => [`has.${e.id}`, true]),
				),
			},
		},
	};
}

/**
 * The folder opener as a labelled split (#1176): the main part opens the default, the
 * chevron lists every opener on this computer and the terminal, the default ticked.
 */
export function DetailsFolder({ ctx }: { ctx: DetailsCtx }) {
	return ctx.opener ? (
		<OpenWithSplit ctx={ctx} opener={ctx.opener} />
	) : (
		<FolderSplit ctx={ctx} />
	);
}

function OpenWithSplit({
	ctx,
	opener,
}: {
	ctx: DetailsCtx;
	opener: NonNullable<DetailsCtx["opener"]>;
}) {
	return <FolderSplit ctx={useOpenWith(ctx, opener)} />;
}

function FolderSplit({ ctx }: { ctx: DetailsCtx }) {
	const folder = row(entryOf("details.openFolder", ctx));
	const others = surfaceEntries("thread.details", "more", ctx).length > 0;
	if (!folder) return null;
	const where = folder.label.replace(/^Open in /, "");
	return (
		<div className="flex min-w-0 items-center rounded-control">
			<Hint label={`Open the folder in ${where}`}>
				<button
					type="button"
					className={cn(
						SPLIT,
						"min-w-0 gap-1 px-1.5 text-meta",
						others ? "rounded-l-control" : "rounded-control",
					)}
					onClick={folder.onSelect}
					data-testid="details-open-folder"
				>
					<FolderOpen aria-hidden className="size-3.5 shrink-0" />
					<span className="truncate">{folder.label}</span>
				</button>
			</Hint>
			{others && (
				<SurfaceMore
					id="thread.details"
					ctx={ctx}
					align="end"
					trigger={
						<button
							type="button"
							aria-label="Open with"
							className={cn(SPLIT, "w-5 shrink-0 rounded-r-control")}
							data-testid="details-open-with"
						>
							<ChevronDown aria-hidden className="size-3" />
						</button>
					}
				/>
			)}
		</div>
	);
}
