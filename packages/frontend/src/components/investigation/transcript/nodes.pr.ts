// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { PrStatusNode } from "./PrStatusNode";
import type { TranscriptNodes } from "./types";

/** PR and checks' transcript nodes (#1101 category 15). Only that lane edits this file. */
export const prNodes: TranscriptNodes = {
	pr_status: { Node: PrStatusNode },
};
