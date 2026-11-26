// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	CircleCheck,
	FileJson,
	Link2,
	SquareArrowOutUpRight,
	Workflow,
} from "lucide-react";
import {
	defineAction,
	defineObject,
	type Facts,
} from "@/components/kit/actions";
import { copyText } from "@/lib/clipboard";

type AlertState =
	| "listed"
	| "hasIncident"
	| "resolvable"
	| "uncorrelated"
	| "hasPayload";

/** One alert: on its page's band and as a row in the list (`useAlertCtx`). */
export interface AlertCtx {
	open: () => void;
	openIncident: () => void;
	incidentLabel: string;
	resolve: () => void;
	correlate: () => void;
	/** The payload as received, pretty-printed when it is JSON; read on copy, not per row. */
	payload: () => string;
	link: string;
	facts: Facts<AlertState>;
}

/** The alert object: the context its actions run with and the states they test. */
export const alertObject = defineObject<AlertCtx, AlertState>("alert");

export const alertOpen = defineAction({
	id: "alert.open",
	label: "Open",
	icon: SquareArrowOutUpRight,
	when: (f) => !!f.is?.listed,
	run: (c) => c.open(),
});

export const alertOpenIncident = defineAction({
	id: "alert.openIncident",
	label: (c: AlertCtx) => `Open ${c.incidentLabel}`,
	icon: SquareArrowOutUpRight,
	when: (f) => !!f.is?.hasIncident,
	run: (c) => c.openIncident(),
});

export const alertCorrelate = defineAction({
	id: "alert.correlate",
	label: "Run correlation",
	icon: Workflow,
	when: (f) => !!f.is?.uncorrelated,
	run: (c) => c.correlate(),
});

export const alertResolve = defineAction({
	id: "alert.resolve",
	label: "Resolve this alert",
	icon: CircleCheck,
	when: (f) => !!f.is?.resolvable,
	run: (c) => c.resolve(),
});

export const alertCopyPayload = defineAction({
	id: "alert.copyPayload",
	label: "Copy the raw payload",
	icon: FileJson,
	when: (f) => !!f.is?.hasPayload,
	run: (c) => void copyText(c.payload()),
});

export const alertCopyLink = defineAction({
	id: "alert.copyLink",
	label: "Copy link",
	icon: Link2,
	run: (c) => void copyText(c.link),
});
