// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ThreadNodeState } from "@prismalens/contracts";
import { defineClosed } from "@prismalens/registry";
import type { StatusKind } from "@/components/kit/Status";

/** A linked thread's state in the closed status set (sheet §9.1): stopped and answered both read Done. */
const LINK_STATES: Record<ThreadNodeState, { status: StatusKind }> = {
	queued: { status: "waiting" },
	running: { status: "working" },
	answered: { status: "done" },
	failed: { status: "failed" },
	stopped: { status: "done" },
};

export const linkStates = defineClosed(
	"linkState",
	Object.keys(LINK_STATES) as ThreadNodeState[],
	LINK_STATES,
);
