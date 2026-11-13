// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Link2, MessageSquarePlus, SquareArrowOutUpRight } from "lucide-react";
import {
	defineAction,
	defineObject,
	type Facts,
} from "@/components/kit/actions";

/** A service's card in the Services list. */
export interface ServiceCtx {
	open: () => void;
	ask: () => void;
	copyLink: () => void;
	facts: Facts<never>;
}

/** The service object: the context its actions run with. */
export const serviceObject = defineObject<ServiceCtx>("service");

export const serviceOpen = defineAction({
	id: "service.open",
	label: "Open",
	icon: SquareArrowOutUpRight,
	run: (c) => c.open(),
});

export const serviceAsk = defineAction({
	id: "service.ask",
	label: "New thread about it",
	icon: MessageSquarePlus,
	run: (c) => c.ask(),
});

export const serviceLink = defineAction({
	id: "service.link",
	label: "Copy link",
	icon: Link2,
	run: (c) => c.copyLink(),
});
