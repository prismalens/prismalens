// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import * as Slot from "@radix-ui/react-slot";
import { MoreHorizontal } from "lucide-react";
import {
	lazy,
	type ReactElement,
	type ReactNode,
	Suspense,
	useCallback,
	useRef,
	useState,
} from "react";
import { useAfterFirstContent } from "@/lib/lazy";
import { cn } from "@/lib/utils";
import type { SurfaceCtx, SurfaceId } from "./actions";
import { setActiveSurface } from "./active-surface";
import { Pressed, useContextTrigger } from "./Menu";
import { useRegistry } from "./registry-load";

// The menus read the registry; a surface draws without it and loads them when asked
// (#1101 category 12).
const menus = () => import("./SurfaceMenus");
const SurfaceMenuAt = lazy(() =>
	menus().then((m) => ({ default: m.SurfaceMenuAt })),
);
const SurfaceMoreMenu = lazy(() =>
	menus().then((m) => ({ default: m.SurfaceMoreMenu })),
);

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
	const registry = useRegistry();
	const { at, close, handlers } = useContextTrigger();
	// Until the registry loads a surface offers its menu; after, only with context rows.
	const offers = !registry || !!registry.surfaceById(id)?.menus.context?.length;
	const current = useCallback(() => latest.current, []);
	return (
		<>
			<Slot.Root
				data-surface={id}
				onFocusCapture={mark}
				onContextMenuCapture={mark}
				{...(offers ? handlers : {})}
			>
				{children}
			</Slot.Root>
			{at && (
				<Suspense fallback={null}>
					<SurfaceMenuAt id={id} ctx={current} at={at} onClose={close} />
				</Suspense>
			)}
		</>
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
	const ready = useAfterFirstContent();
	const [pressed, setPressed] = useState(false);
	const registry = useRegistry();
	const triggerOf = (label: string) =>
		trigger ?? (
			<button
				type="button"
				aria-label={label}
				className={cn(MORE, className)}
				data-testid={`${id}-more`}
			>
				<MoreHorizontal className="size-3.5" aria-hidden />
			</button>
		);
	const held = (
		<Pressed onPress={() => setPressed(true)}>
			{triggerOf(registry?.surfaceById(id)?.label ?? "Actions")}
		</Pressed>
	);
	if (!ready && !pressed) return held;
	return (
		<Suspense fallback={held}>
			<SurfaceMoreMenu
				id={id}
				ctx={ctx}
				trigger={triggerOf}
				side={side}
				align={align}
				open={open}
				onOpenChange={onOpenChange}
				defaultOpen={pressed}
			/>
		</Suspense>
	);
}
