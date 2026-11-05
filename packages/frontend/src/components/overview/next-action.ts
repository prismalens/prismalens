// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { RefObject } from "react";
import type { NextActionId } from "./fixes";
import type { Overview } from "./use-overview";

/** What the page itself does for the actions that start, resume or ask. */
export interface NextPageActions {
	investigate: () => void;
	ask: () => void;
	resume: () => void;
	watch: () => void;
	/** Where a missing service is added; pages without one omit it. */
	services?: () => void;
	commandRef: RefObject<HTMLElement | null>;
}

/** The Next strip's buttons, the same on the overview and beside a transcript (D19). */
export function nextHandler(o: Overview, page: NextPageActions) {
	return (id: NextActionId) => {
		const opt = o.current;
		switch (id) {
			case "copy":
				if (opt) void o.copy(opt, page.commandRef.current);
				return;
			case "applied":
				if (opt) o.apply(opt);
				return;
			case "check":
				if (opt) void o.check(opt);
				return;
			case "next-option":
				o.nextOption();
				return;
			case "resolve":
				o.record.openClose();
				return;
			case "resume":
				page.resume();
				return;
			case "retry":
			case "investigate":
				page.investigate();
				return;
			case "ask":
				page.ask();
				return;
			case "watch":
				page.watch();
				return;
			case "services":
				page.services?.();
				return;
		}
	};
}
