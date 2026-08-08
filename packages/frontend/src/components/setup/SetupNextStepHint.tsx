// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

/**
 * "Here is what is still missing" — the on-ramp that turns a dead-end empty
 * screen into a next action (#332).
 *
 * A fresh database renders three blank screens (dashboard, incidents, alerts)
 * that each say some variant of "nothing here yet" and offer nowhere to go.
 * This component asks `setup.getStatus` what is genuinely incomplete and names
 * the first one, so the empty state always points at a door.
 *
 * `/setup` is the link target for wizard-shaped work because the wizard's own
 * resume logic already lands on the first incomplete step — no query
 * parameter can go stale here.
 */

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useSetupStatus } from "@/lib/api/hooks";

export interface SetupNextStepHintProps {
	/**
	 * Rendered when setup has nothing outstanding — the screen is empty for
	 * ordinary reasons, not because the instance is unconfigured.
	 */
	fallback?: ReactNode;
	className?: string;
}

interface Hint {
	message: string;
	actions: ReactNode;
}

export function SetupNextStepHint({
	fallback = null,
	className,
}: SetupNextStepHintProps) {
	const { data: status, isLoading } = useSetupStatus();

	// Say nothing rather than flashing a wrong nag while the status loads.
	if (isLoading || !status) return null;

	const { steps } = status;
	let hint: Hint | null = null;

	if (!steps.aiProvider) {
		hint = {
			message:
				"No AI provider is configured, so investigations cannot run yet.",
			actions: (
				<>
					<Button size="sm" asChild>
						<Link to="/setup" search={{ redirect: undefined }}>
							Finish setup
						</Link>
					</Button>
					<Button variant="outline" size="sm" asChild>
						<Link to="/settings" search={{ tab: "ai" }}>
							AI provider settings
						</Link>
					</Button>
				</>
			),
		};
	} else if (!steps.codeLocation) {
		hint = {
			message:
				"No service points at a local checkout, so investigations would read the wrong code.",
			actions: (
				<>
					<Button size="sm" asChild>
						<Link to="/setup" search={{ redirect: undefined }}>
							Map a checkout
						</Link>
					</Button>
					<Button variant="outline" size="sm" asChild>
						<Link to="/services">Services</Link>
					</Button>
				</>
			),
		};
	} else if (!steps.firstIncident) {
		hint = {
			message:
				"No incidents yet. Author one by hand, or connect a monitoring tool and let alerts correlate.",
			actions: (
				<>
					<Button size="sm" asChild>
						<Link to="/incidents">Go to incidents</Link>
					</Button>
					<Button variant="outline" size="sm" asChild>
						<Link to="/settings" search={{ tab: "integrations" }}>
							Connect a tool
						</Link>
					</Button>
				</>
			),
		};
	}

	if (!hint) return <>{fallback}</>;

	return (
		<div className={className}>
			<p className="text-sm text-muted-foreground">{hint.message}</p>
			<div className="mt-3 flex flex-wrap justify-center gap-2">
				{hint.actions}
			</div>
		</div>
	);
}
