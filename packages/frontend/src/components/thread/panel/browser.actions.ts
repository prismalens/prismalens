// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Bot, ExternalLink, Hand, Link2, RotateCw, X } from "lucide-react";
import {
	defineAction,
	defineObject,
	type Facts,
} from "@/components/kit/actions";
import { copyText } from "@/lib/clipboard";

type BrowserState = "hasUrl" | "agent";

/** One tab of the thread's host browser (#1061): its page, and who drives it. */
export interface BrowserTabCtx {
	url: string;
	reload: () => void;
	close: () => void;
	/** Hands the tab to the person, or back to the agent. */
	control: (to: "human" | "agent") => void;
	facts: Facts<BrowserState>;
}

/** The browser tab object: the context its actions run with and the states they test. */
export const browserObject = defineObject<BrowserTabCtx, BrowserState>(
	"browser",
);

export const browserReload = defineAction({
	id: "browser.reload",
	label: "Reload",
	icon: RotateCw,
	run: (c) => c.reload(),
});

export const browserCopyUrl = defineAction({
	id: "browser.copyUrl",
	label: "Copy address",
	icon: Link2,
	when: (f) => !!f.is?.hasUrl,
	run: (c) => void copyText(c.url),
});

export const browserOpenOutside = defineAction({
	id: "browser.openOutside",
	label: "Open in your browser",
	icon: ExternalLink,
	when: (f) => !!f.is?.hasUrl,
	run: (c) => void window.open(c.url, "_blank", "noreferrer"),
});

export const browserTakeControl = defineAction({
	id: "browser.takeControl",
	label: "Take control",
	icon: Hand,
	when: (f) => !!f.is?.agent,
	run: (c) => c.control("human"),
});

export const browserHandBack = defineAction({
	id: "browser.handBack",
	label: "Hand back",
	icon: Bot,
	when: (f) => !f.is?.agent,
	run: (c) => c.control("agent"),
});

export const browserClose = defineAction({
	id: "browser.close",
	label: "Close tab",
	icon: X,
	run: (c) => c.close(),
});
