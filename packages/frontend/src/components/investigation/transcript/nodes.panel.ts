// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	ChildFinishedNode,
	ProposalNode,
	ProposalResolvedNode,
	ThreadMessageNode,
	ThreadStartedNode,
} from "./TreeNodes";
import type { TranscriptNodes } from "./types";

/** UI 2's transcript nodes (#1024): the thread tree's events. Only UI 2 edits this file. */
export const panelNodes: TranscriptNodes = {
	thread_started: { Node: ThreadStartedNode },
	thread_message: { Node: ThreadMessageNode },
	child_finished: { Node: ChildFinishedNode },
	action_proposed: { Node: ProposalNode },
	action_resolved: { Node: ProposalResolvedNode },
};
