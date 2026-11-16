// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Copy, MessageSquareQuote, SquareTerminal } from "lucide-react";
import {
	defineAction,
	defineObject,
	type Facts,
} from "@/components/kit/actions";

/**
 * A special block on screen, built by the kit `Block` from its `defineBlock`
 * declaration: the facts say which of the three actions the kind offers.
 */
export interface BlockCtx {
	copyLabel: string;
	copy: () => void;
	run: () => void;
	addToComposer: () => void;
	facts: Facts<"runnable" | "quotable">;
}

/** The block object: the context its actions run with and the states they test. */
export const blockObject = defineObject<BlockCtx, "runnable" | "quotable">(
	"block",
);

export const blockCopy = defineAction({
	id: "block.copy",
	keys: { combo: "Alt+C", label: "Copy the focused block", group: "Thread" },
	label: (c) => c.copyLabel,
	icon: Copy,
	run: (c) => c.copy(),
});

export const blockRun = defineAction({
	id: "block.run",
	keys: {
		combo: "Alt+T",
		label: "Send the focused command to the terminal",
		group: "Thread",
	},
	label: "Send to terminal",
	icon: SquareTerminal,
	when: (f) => !!f.is?.runnable,
	run: (c) => c.run(),
});

export const blockAddToComposer = defineAction({
	id: "block.addToComposer",
	keys: {
		combo: "Alt+Q",
		label: "Add the focused block or selection to the message",
		group: "Thread",
	},
	label: "Add to composer",
	icon: MessageSquareQuote,
	when: (f) => !!f.is?.quotable,
	run: (c) => c.addToComposer(),
});
