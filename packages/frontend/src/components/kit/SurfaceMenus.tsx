// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { type ReactNode, useEffect } from "react";
import type { SurfaceCtx, SurfaceId } from "./actions";
import { ContextMenuAt, Menu } from "./MenuImpl";
import { surfaceById, surfaceEntries } from "./registry";

// A surface's menus with the registry they read: loaded after the first content, or when a
// menu is asked for (#1101 category 12).

/** The surface's context menu at a point; a surface with no context rows closes it at once. */
export function SurfaceMenuAt<S extends SurfaceId>({
	id,
	ctx,
	at,
	onClose,
}: {
	id: S;
	ctx: () => SurfaceCtx<S>;
	at: { x: number; y: number };
	onClose: () => void;
}) {
	const surface = surfaceById(id);
	const none = !surface?.menus.context?.length;
	useEffect(() => {
		if (none) onClose();
	}, [none, onClose]);
	if (none || !surface) return null;
	return (
		<ContextMenuAt
			at={at}
			label={surface.label}
			entries={() => surfaceEntries(id, "context", ctx())}
			onClose={onClose}
		/>
	);
}

/** The surface's visible ⋯ menu, with the same rows its registry lists under `more`. */
export function SurfaceMoreMenu<S extends SurfaceId>({
	id,
	ctx,
	trigger,
	side,
	align,
	open,
	onOpenChange,
	defaultOpen,
}: {
	id: S;
	ctx: SurfaceCtx<S>;
	trigger: (label: string) => ReactNode;
	side?: "top" | "bottom";
	align?: "start" | "end";
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	defaultOpen?: boolean;
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
			defaultOpen={defaultOpen}
			trigger={trigger(label)}
		/>
	);
}
