// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	CompactionEventNode,
	LimitEventNode,
} from "@/components/thread/session/SessionTranscriptNodes";
import type { TranscriptNodes } from "./types";

/** UI 3's transcript nodes (#1024). Only UI 3 edits this file. */
export const appNodes: TranscriptNodes = {
	compaction: { Node: CompactionEventNode },
	usage_limit: { Node: LimitEventNode },
	resume_scheduled: { Node: LimitEventNode },
	resumed: { Node: LimitEventNode },
};
