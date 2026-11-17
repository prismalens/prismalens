// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createElement } from "react";
import { lazyPart } from "@/lib/lazy";
import { PrStatusNode } from "./PrStatusNode";
import type { TranscriptNodes } from "./types";

// A subscription line carries its list's query and actions; it loads with the first one (#1179).
const PrSubscriptionNode = lazyPart(
	() => import("./PrSubscriptionNode").then((m) => m.PrSubscriptionNode),
	createElement("span", { className: "text-meta text-text-3" }, "Subscription"),
);

/** PR and checks' transcript nodes (#1101 category 15). Only that lane edits this file. */
export const prNodes = {
	pr_status: { Node: PrStatusNode },
	pr_subscription: { Node: PrSubscriptionNode },
} satisfies TranscriptNodes;
