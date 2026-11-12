// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ChevronDown, FolderOpen } from "lucide-react";
import { Menu, type MenuEntry } from "@/components/kit/Menu";
import { entryOf } from "@/components/kit/registry";
import { Hint } from "@/components/shared/Hint";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DetailsCtx } from "./details.actions";
import type { GitAction } from "./git-action";

const VARIANT: Record<GitAction, "primary" | "secondary" | "danger"> = {
	push: "primary",
	createPr: "primary",
	markReady: "primary",
	fixChecks: "danger",
	resolveConflicts: "danger",
	viewPr: "secondary",
};

type Row = Exclude<MenuEntry, { separator: true }>;
const row = (e: MenuEntry | null): Row | null =>
	e && !("separator" in e) ? e : null;

const SPLIT =
	"flex h-6 items-center justify-center text-text-2 outline-none hover:bg-surface-3 hover:text-text-1 focus-visible:ring-2 focus-visible:ring-accent data-[state=open]:bg-surface-3";

/**
 * The card's controls: the folder opener with the terminal behind its chevron,
 * and the one git action, all run from their registered ids (#1125).
 */
export function DetailsActions({
	ctx,
	primary,
}: {
	ctx: DetailsCtx;
	primary: GitAction | null;
}) {
	const action = primary ? row(entryOf(`details.${primary}`, ctx)) : null;
	const folder = row(entryOf("details.openFolder", ctx));
	const others = [row(entryOf("details.openTerminal", ctx))].filter(
		(e): e is Row => !!e,
	);
	return (
		<div className="flex h-7 items-center gap-2 px-2">
			{folder && (
				<div className="flex items-center rounded-control">
					<Hint label="Open folder">
						<button
							type="button"
							aria-label="Open folder"
							className={cn(SPLIT, "w-7 rounded-l-control")}
							onClick={folder.onSelect}
							data-testid="details-open-folder"
						>
							<FolderOpen aria-hidden className="size-3.5" />
						</button>
					</Hint>
					{others.length > 0 && (
						<Menu
							label="Open with"
							align="start"
							entries={others}
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
			)}
			<span className="flex-1" />
			{action && primary && (
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
			)}
		</div>
	);
}
