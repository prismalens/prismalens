// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { CompactionDivider } from "./CompactionDivider";
import type { TranscriptNodes } from "./types";

/** Context's transcript nodes (#1101 cat 11): compaction as a divider. */
export const contextNodes: TranscriptNodes = {
	compaction: { Node: CompactionDivider },
};
