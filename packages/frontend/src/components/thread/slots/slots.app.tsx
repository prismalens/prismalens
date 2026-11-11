// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useSessionSlots } from "@/components/thread/session/useSessionSlots";
import type { LaneSlots, SlotContext } from "./types";

/** UI 3's page slots: the context meter, and the usage-limit and cold-conversation docks (#1024). Only UI 3 edits this file. */
export function useAppSlots(ctx: SlotContext): LaneSlots {
	return useSessionSlots(ctx);
}
