// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { AwayDigest } from "@/components/home/AwayView";

/**
 * Home under the composer: what changed since you were last here, on every width. What
 * waits on you lives in the sidebar's Needs you, or its badge where the list is off screen
 * (#1247 D25: one place calls for attention, GUIDELINES rule 3).
 */
export function HomeHandover() {
	return (
		<div className="flex w-full flex-col gap-6" data-testid="home-handover">
			<AwayDigest />
		</div>
	);
}
