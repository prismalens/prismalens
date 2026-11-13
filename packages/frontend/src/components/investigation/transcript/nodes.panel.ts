// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	ProposalNode,
	ProposalResolvedNode,
	ThreadMessageNode,
	ThreadStartedNode,
	ThreadsStoppedNode,
} from "./TreeNodes";
import type { TranscriptNodes } from "./types";

/** UI 2's transcript nodes (#1024): starts, messages and proposals between threads. Only UI 2 edits this file. */
export const panelNodes = {
	thread_started: { Node: ThreadStartedNode },
	thread_message: { Node: ThreadMessageNode },
	threads_stopped: { Node: ThreadsStoppedNode },
	action_proposed: { Node: ProposalNode },
	action_resolved: { Node: ProposalResolvedNode },
} satisfies TranscriptNodes;
