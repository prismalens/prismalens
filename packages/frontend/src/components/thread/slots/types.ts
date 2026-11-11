// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { PendingAsk } from "@prismalens/contracts";
import type { ReactNode } from "react";
import type { SendInterceptor } from "@/lib/composer-send";

/** What a page tells every lane's slots. */
export interface SlotContext {
	page: "thread" | "run";
	/** The run on screen; null on an incident's draft. */
	threadId: string | null;
	incidentId: string | null;
	live: boolean;
	/** Open asks from the durable ask record, whether or not the run is live. */
	asks: PendingAsk[];
}

/** A dock above the box; lower `order` sits higher. */
export interface DockItem {
	id: string;
	order: number;
	node: ReactNode;
}

/** What one lane puts in a page's slots this render; absent or null shows nothing. */
export interface LaneSlots {
	dock?: (DockItem | null)[];
	composerFooter?: ReactNode;
	banner?: ReactNode;
	interceptor?: SendInterceptor | null;
}

/** Each lane's slot file exports one hook of this shape; it may hold state. */
export type UseLaneSlots = (ctx: SlotContext) => LaneSlots;

/** The dock stack's order, top first (#1024). */
export const DOCK_ORDER = {
	ask: 10,
	usageLimit: 20,
	coldConversation: 30,
} as const;
