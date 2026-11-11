// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ReactNode } from "react";
import type { SendInterceptor } from "@/lib/composer-send";
import { useAppSlots } from "./slots.app";
import { useComposerSlots } from "./slots.composer";
import { usePanelSlots } from "./slots.panel";
import type { DockItem, LaneSlots, SlotContext } from "./types";

export type { SlotContext } from "./types";

/** The page's filled slots: null where no lane put anything. */
export interface PageSlots {
	dock: ReactNode;
	composerFooter: ReactNode;
	banner: ReactNode;
	interceptors: SendInterceptor[];
}

/** Merges the lanes' slots; the dock stacks by `order`, then lane order. */
export function mergeSlots(lanes: readonly LaneSlots[]): PageSlots {
	const docks = lanes
		.flatMap((l) => l.dock ?? [])
		.filter((d): d is DockItem => !!d && d.node != null && d.node !== false)
		.sort((a, b) => a.order - b.order);
	const all = (key: "composerFooter" | "banner") => {
		const nodes = lanes
			.map((l, i) => [i, l[key]] as const)
			.filter(([, n]) => n != null && n !== false);
		return nodes.length ? (
			<>
				{nodes.map(([i, n]) => (
					<div key={i} className="contents">
						{n}
					</div>
				))}
			</>
		) : null;
	};
	return {
		dock: docks.length ? (
			<>
				{docks.map((d) => (
					<div key={d.id} className="contents" data-dock={d.id}>
						{d.node}
					</div>
				))}
			</>
		) : null,
		composerFooter: all("composerFooter"),
		banner: all("banner"),
		interceptors: lanes.flatMap((l) => (l.interceptor ? [l.interceptor] : [])),
	};
}

/** Every lane's slots for one page; the hooks run in a fixed order each render. */
export function usePageSlots(ctx: SlotContext): PageSlots {
	return mergeSlots([
		useComposerSlots(ctx),
		usePanelSlots(ctx),
		useAppSlots(ctx),
	]);
}
