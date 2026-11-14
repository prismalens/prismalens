// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { PanelRight, SendHorizontal } from "lucide-react";
import {
	defineAction,
	defineObject,
	type Facts,
} from "@/components/kit/actions";

/** An incoming message's row: a PR watch, a wake, a schedule or another thread. */
export interface InboundCtx {
	/** Puts the message in the composer, so a new turn carries it. */
	sendAgain: () => void;
	openPr: () => void;
	facts: Facts<"failed" | "pr">;
}

export const inboundObject = defineObject<InboundCtx, "failed" | "pr">(
	"inbound",
);

/** The agent never got it: a new turn you send carries it instead (#1101 category 10). */
export const inboundSendAgain = defineAction({
	id: "inbound.sendAgain",
	label: "Send as a new turn",
	icon: SendHorizontal,
	when: (f) => !!f.is?.failed,
	run: (c) => c.sendAgain(),
});

export const inboundOpenPr = defineAction({
	id: "inbound.openPr",
	label: "Open checks",
	icon: PanelRight,
	when: (f) => !!f.is?.pr,
	run: (c) => c.openPr(),
});
