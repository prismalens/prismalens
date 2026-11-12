// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Copy, Search, Square } from "lucide-react";
import { defineAction, type Facts } from "@/components/kit/actions";

/** The gallery's sample object: a tool call with a command, shown in `menu-object`. */
export interface SampleCtx {
	command: string;
	facts: Facts<"running">;
	log: (what: string) => void;
}

declare module "@/components/kit/actions" {
	interface ObjectContexts {
		sample: SampleCtx;
	}
	interface ObjectStates {
		sample: "running";
	}
	interface ActionObjects {
		"sample.copy": "sample";
		"sample.find": "sample";
		"sample.stop": "sample";
	}
}

export const sampleCopy = defineAction({
	id: "sample.copy",
	label: "Copy command",
	icon: Copy,
	run: (c) => c.log(`copy ${c.command}`),
});

export const sampleFind = defineAction({
	id: "sample.find",
	label: "Find in the thread",
	icon: Search,
	run: (c) => c.log("find"),
});

export const sampleStop = defineAction({
	id: "sample.stop",
	label: "Stop",
	icon: Square,
	destructive: true,
	when: (f) => !!f.is?.running,
	run: (c) => c.log("stop"),
});
