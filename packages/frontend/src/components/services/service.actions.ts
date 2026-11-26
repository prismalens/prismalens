// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	Link2,
	MessageSquarePlus,
	SquareArrowOutUpRight,
	SquarePen,
	Trash2,
} from "lucide-react";
import {
	defineAction,
	defineObject,
	type Facts,
} from "@/components/kit/actions";
import { copyText } from "@/lib/clipboard";

/** A service's page band, or its card in the Services list. */
export interface ServiceCtx {
	open: () => void;
	ask: () => void;
	/** The service page's address. */
	link: string;
	edit: () => void;
	remove: () => void;
	facts: Facts<"listed">;
}

/** The service object: the context its actions run with and the states they test. */
export const serviceObject = defineObject<ServiceCtx, "listed">("service");

export const serviceOpen = defineAction({
	id: "service.open",
	label: "Open",
	icon: SquareArrowOutUpRight,
	when: (f) => !!f.is?.listed,
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
	run: (c) => void copyText(c.link),
});

export const serviceEdit = defineAction({
	id: "service.edit",
	label: "Edit",
	icon: SquarePen,
	run: (c) => c.edit(),
});

export const serviceDelete = defineAction({
	id: "service.delete",
	label: "Delete",
	icon: Trash2,
	destructive: true,
	run: (c) => c.remove(),
});
