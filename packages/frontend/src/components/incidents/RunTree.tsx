// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { RunState } from "@prismalens/contracts";
import { cn } from "@/lib/utils";
import { runDot } from "./run-facts";

/** A run's state as a dot: breathing while live (#811). The sidebar's tree is IncidentTree now. */
export function RunDot({
	state,
	draft,
	className,
}: {
	state?: RunState;
	draft?: boolean;
	className?: string;
}) {
	const tone = state ? runDot(state) : null;
	return (
		<span
			aria-hidden
			className={cn(
				"size-1.5 shrink-0 rounded-full",
				draft &&
					"outline-[1.5px] -outline-offset-[1.5px] outline-text-3 outline-solid",
				tone === "live" && "breathe bg-live",
				tone === "ok" && "bg-ok",
				tone === "danger" && "bg-danger",
				tone === "quiet" && "bg-text-3",
				className,
			)}
			data-dot={draft ? "draft" : (tone ?? undefined)}
		/>
	);
}
