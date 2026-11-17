// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { PrStatusNode } from "./PrStatusNode";
import { PrSubscriptionNode } from "./PrSubscriptionNode";
import type { TranscriptNodes } from "./types";

/** PR and checks' transcript nodes (#1101 category 15). Only that lane edits this file. */
export const prNodes = {
	pr_status: { Node: PrStatusNode },
	pr_subscription: { Node: PrSubscriptionNode },
} satisfies TranscriptNodes;
