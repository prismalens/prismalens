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
	/** The composer's draft, for a dock that sends it later (#1101). */
	draft?: string;
	/** Sends a message to this thread with a field such as another model (#1101). */
	send?: (text: string, fields: { model?: string }) => Promise<void>;
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
	connection: 5,
	ask: 10,
	usageLimit: 20,
	interrupted: 25,
	coldConversation: 30,
} as const;
