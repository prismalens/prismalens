// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { RunState } from "@prismalens/contracts";
import { cn } from "@/lib/utils";
import { runDot } from "./run-facts";

/** A run's state as a dot: breathing while live (#811). The sidebar's tree is IncidentTree now. */
export function RunDot({
	state,
	draft,
	waiting,
	className,
}: {
	state?: RunState;
	draft?: boolean;
	/** The live run waits on your answer: amber (#673 w5-14). */
	waiting?: boolean;
	className?: string;
}) {
	const tone = waiting ? "warn" : state ? runDot(state) : null;
	return (
		<span
			aria-hidden
			className={cn(
				"size-1.5 shrink-0 rounded-full",
				draft &&
					"outline-[1.5px] -outline-offset-[1.5px] outline-text-3 outline-solid",
				tone === "live" && "breathe bg-live",
				tone === "warn" && "breathe bg-warn",
				tone === "ok" && "bg-ok",
				tone === "danger" && "bg-danger",
				tone === "quiet" && "bg-text-3",
				className,
			)}
			data-dot={draft ? "draft" : (tone ?? undefined)}
		/>
	);
}
