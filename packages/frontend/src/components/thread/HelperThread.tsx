// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { HelperPlace } from "@prismalens/contracts";
import { cn } from "@/lib/utils";
import { NewThread } from "./NewThread";

const PLACEHOLDER: Record<HelperPlace, string> = {
	alerts: "Ask how to send alerts",
	services: "Ask how to add a service",
	schedules: "Ask how schedules work",
};

/**
 * The shared composer on an empty page (#1020): it starts a no-subject chat whose
 * context the server words from `place` alone, so no page data or token reaches it.
 */
export function HelperThread({
	place,
	className,
}: {
	place: HelperPlace;
	className?: string;
}) {
	return (
		<div
			className={cn("w-full max-w-(--reading-w)", className)}
			data-testid="helper-thread"
			data-place={place}
		>
			<NewThread
				subject={{ kind: "none" }}
				branch={null}
				place={place}
				placeholder={PLACEHOLDER[place]}
				autoFocus={false}
			/>
		</div>
	);
}
