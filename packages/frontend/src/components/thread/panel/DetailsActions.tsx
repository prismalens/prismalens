// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, FolderOpen } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
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

/**
 * Whether the labelled split fits beside the place name (#1176): the name wins the row's
 * width, so the split shows its words only while the name still reads whole beside them.
 */
function useLabelFits(text: string) {
	const root = useRef<HTMLDivElement>(null);
	const words = useRef<HTMLSpanElement>(null);
	const [wide, setWide] = useState(false);
	useLayoutEffect(() => {
		if (!text) return;
		const row = root.current?.closest('[data-testid="details-place"]');
		const name = row?.querySelector(
			'[data-testid="details-place-name"]',
		)?.parentElement;
		if (!row || !name) {
			setWide(true);
			return;
		}
		const fit = () => {
			const slack = name.clientWidth - name.scrollWidth;
			// The labelled split is its words plus about 50 px; the folded one is a 24 px button.
			const need = (words.current?.offsetWidth ?? 0) + 30;
			setWide((w) => (w ? slack >= 0 : slack >= need));
		};
		fit();
		const watch = new ResizeObserver(fit);
		watch.observe(row);
		return () => watch.disconnect();
	}, [text]);
	return { root, words, wide };
}

function FolderSplit({ ctx }: { ctx: DetailsCtx }) {
	const folder = row(entryOf("details.openFolder", ctx));
	const others = surfaceEntries("thread.details", "more", ctx).length > 0;
	const { root, words, wide } = useLabelFits(folder?.label ?? "");
	if (!folder) return null;
	const where = folder.label.replace(/^Open in /, "");
	const measure = (
		<span
			ref={words}
			aria-hidden
			className="pointer-events-none invisible absolute whitespace-nowrap text-meta"
		>
			{folder.label}
		</span>
	);
	// Too narrow for words: one button opens the openers, the default ticked first.
	const folded = !wide && others;
	return (
		<div
			ref={root}
			className={cn(
				"relative flex items-center rounded-control",
				folded ? "shrink-0" : "min-w-0",
			)}
		>
			{measure}
			{!folded && (
				<Hint label={`Open the folder in ${where}`}>
					<button
						type="button"
						aria-label={folder.label}
						className={cn(
							SPLIT,
							"min-w-0 gap-1 text-meta",
							wide ? "px-1.5" : "w-6",
							others ? "rounded-l-control" : "rounded-control",
						)}
						onClick={folder.onSelect}
						data-testid="details-open-folder"
					>
						<FolderOpen aria-hidden className="size-3.5 shrink-0" />
						{wide && <span className="truncate">{folder.label}</span>}
					</button>
				</Hint>
			)}
			{others && (
				<SurfaceMore
					id="thread.details"
					ctx={ctx}
					align="end"
					trigger={
						<button
							type="button"
							aria-label={
								folded ? `Open with (${where} by default)` : "Open with"
							}
							className={cn(
								SPLIT,
								folded
									? "w-6 rounded-control"
									: "w-5 shrink-0 rounded-r-control",
							)}
							data-testid="details-open-with"
						>
							{folded ? (
								<FolderOpen aria-hidden className="size-3.5" />
							) : (
								<ChevronDown aria-hidden className="size-3" />
							)}
						</button>
					}
				/>
			)}
		</div>
	);
}
