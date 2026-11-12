// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { MoreHorizontal } from "lucide-react";
import { Slot } from "radix-ui";
import { type ReactElement, type ReactNode, useRef } from "react";
import { cn } from "@/lib/utils";
import type { SurfaceCtx, SurfaceId } from "./actions";
import { ContextMenu, Menu } from "./Menu";
import { setActiveSurface, surfaceById, surfaceEntries } from "./registry";

/**
 * A registered object on screen (#1125): it carries `data-surface`, opens the
 * surface's context menu on right-click, Shift+F10, the Menu key and a long
 * press, and becomes the palette's focused surface on focus or right-click.
 */
export function Surface<S extends SurfaceId>({
	id,
	ctx,
	children,
}: {
	id: S;
	ctx: SurfaceCtx<S>;
	children: ReactElement;
}) {
	const latest = useRef(ctx);
	latest.current = ctx;
	const mark = () => setActiveSurface({ id, ctx: () => latest.current });
	const surface = surfaceById(id);
	const body = (
		<Slot.Root
			data-surface={id}
			onFocusCapture={mark}
			onContextMenuCapture={mark}
		>
			{children}
		</Slot.Root>
	);
	if (!surface?.menus.context?.length) return body;
	return (
		<ContextMenu
			label={surface.label}
			entries={surfaceEntries(id, "context", ctx)}
		>
			{body}
		</ContextMenu>
	);
}

const MORE =
	"flex size-6 items-center justify-center rounded-control text-text-2 outline-none hover:bg-surface-3 hover:text-text-1 focus-visible:ring-2 focus-visible:ring-accent data-[state=open]:bg-surface-3";

/** The surface's visible ⋯ menu, with the same rows its registry lists under `more`. */
export function SurfaceMore<S extends SurfaceId>({
	id,
	ctx,
	trigger,
	className,
	side,
	align,
	open,
	onOpenChange,
}: {
	id: S;
	ctx: SurfaceCtx<S>;
	/** A custom trigger; the default is the kit's ⋯ button. */
	trigger?: ReactNode;
	className?: string;
	side?: "top" | "bottom";
	align?: "start" | "end";
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
}) {
	const label = surfaceById(id)?.label ?? "Actions";
	return (
		<Menu
			label={label}
			entries={surfaceEntries(id, "more", ctx)}
			side={side}
			align={align}
			open={open}
			onOpenChange={onOpenChange}
			trigger={
				trigger ?? (
					<button
						type="button"
						aria-label={label}
						className={cn(MORE, className)}
						data-testid={`${id}-more`}
					>
						<MoreHorizontal className="size-3.5" aria-hidden />
					</button>
				)
			}
		/>
	);
}
