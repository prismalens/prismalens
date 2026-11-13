// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Link2, PanelRightOpen, Square } from "lucide-react";
import { defineAction, type Facts } from "@/components/kit/actions";
import { copyText } from "@/lib/clipboard";

/** A started thread's row in its starter's transcript. */
export interface ChildCtx {
	/** The started thread's absolute link, for Copy link. */
	href: string;
	open: () => void;
	stop: () => void;
	facts: Facts<"running">;
}

declare module "@/components/kit/actions" {
	interface ObjectContexts {
		child: ChildCtx;
	}
	interface ObjectStates {
		child: "running";
	}
	interface ActionObjects {
		"child.open": "child";
		"child.copyLink": "child";
		"child.stop": "child";
	}
}

export const childOpen = defineAction({
	id: "child.open",
	label: "Open",
	icon: PanelRightOpen,
	run: (c) => c.open(),
});

export const childCopyLink = defineAction({
	id: "child.copyLink",
	label: "Copy link",
	icon: Link2,
	run: (c) => void copyText(c.href),
});

export const childStop = defineAction({
	id: "child.stop",
	label: "Stop",
	icon: Square,
	destructive: true,
	when: (f) => !!f.is?.running,
	run: (c) => c.stop(),
});
