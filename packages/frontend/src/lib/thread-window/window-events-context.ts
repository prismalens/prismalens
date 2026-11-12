// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent } from "@prismalens/contracts";
import { createContext, useContext } from "react";

/**
 * The windowed thread's loaded events, for anything on its page that reads the
 * record: it reads the window, never the whole history (#1101 cat 12).
 */
export interface WindowEvents {
	threadId: string;
	events: CanonicalEvent[];
}

export const ThreadWindowEvents = createContext<WindowEvents | null>(null);

/** The open window's events when this thread is the one on the page; null elsewhere. */
export function useWindowEventsFor(threadId: string): CanonicalEvent[] | null {
	const shared = useContext(ThreadWindowEvents);
	return shared && shared.threadId === threadId ? shared.events : null;
}
