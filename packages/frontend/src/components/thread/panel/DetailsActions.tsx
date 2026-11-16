// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ChevronDown, FolderOpen } from "lucide-react";
import type { MenuEntry } from "@/components/kit/Menu";
import { entryOf, surfaceEntries } from "@/components/kit/registry";
import { SurfaceMore } from "@/components/kit/Surface";
import { Hint } from "@/components/shared/Hint";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DetailsCtx } from "./details.actions";
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

/** The folder opener with the terminal behind its chevron: the place slot's control. */
export function DetailsFolder({ ctx }: { ctx: DetailsCtx }) {
	const folder = row(entryOf("details.openFolder", ctx));
	const others = surfaceEntries("thread.details", "more", ctx).length > 0;
	if (!folder) return null;
	return (
		<div className="flex items-center rounded-control">
			<Hint label={folder.label}>
				<button
					type="button"
					aria-label={folder.label}
					className={cn(
						SPLIT,
						"w-6",
						others ? "rounded-l-control" : "rounded-control",
					)}
					onClick={folder.onSelect}
					data-testid="details-open-folder"
				>
					<FolderOpen aria-hidden className="size-3.5" />
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
							className={cn(SPLIT, "w-4 rounded-r-control")}
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
