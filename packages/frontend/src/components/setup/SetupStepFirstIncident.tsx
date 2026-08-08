// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

/**
 * Wizard step 4 — the on-ramp into a first investigation (#332).
 *
 * DELIBERATELY A HAND-OFF, NOT A FORM. Manual incident authorship is #286's
 * surface (`CreateIncidentDialog`, in flight on `feat/286-manual-authorship`).
 * Building a second creation form here would give the product two ways to
 * author an incident that drift apart, so this step sends the operator to the
 * screen that owns it and marks itself done as soon as an incident exists —
 * `setup.getStatus` derives `firstIncident` from `incident.count()`, so
 * whichever route they take, coming back to /setup shows this step ticked.
 *
 * SEAM: when #286 lands, replace the "Create an incident" link with its dialog
 * mounted inline. Nothing else about the step changes — `onComplete` and the
 * derived status already behave correctly.
 */

import { Link } from "@tanstack/react-router";
import { ArrowRight, FileText, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

export interface SetupStepFirstIncidentProps {
	/** Finish the wizard and go to the app. */
	onComplete: () => void;
}

export function SetupStepFirstIncident({
	onComplete,
}: SetupStepFirstIncidentProps) {
	return (
		<Card>
			<CardHeader className="text-center">
				<div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
					<Rocket className="h-8 w-8 text-primary" />
				</div>
				<CardTitle>
					<h2>Run your first investigation</h2>
				</CardTitle>
				<CardDescription>
					PrismaLens investigates incidents. You can wait for your monitoring
					tools to raise one, or author one by hand to see the whole loop now.
				</CardDescription>
			</CardHeader>

			<CardContent className="space-y-3">
				<Link
					to="/incidents"
					className="flex items-start gap-3 rounded-lg border p-4 transition-colors hover:bg-muted/50"
				>
					<FileText
						className="mt-0.5 h-5 w-5 text-muted-foreground"
						aria-hidden="true"
					/>
					<span className="space-y-1">
						<span className="block text-sm font-medium">
							Create an incident by hand
						</span>
						<span className="block text-sm text-muted-foreground">
							Describe what is broken, pick the service, and start an
							investigation against the checkout you just mapped.
						</span>
					</span>
					<ArrowRight
						className="mt-0.5 ml-auto h-4 w-4 text-muted-foreground"
						aria-hidden="true"
					/>
				</Link>

				<Link
					to="/settings"
					search={{ tab: "integrations" }}
					className="flex items-start gap-3 rounded-lg border p-4 transition-colors hover:bg-muted/50"
				>
					<ArrowRight
						className="mt-0.5 h-5 w-5 text-muted-foreground"
						aria-hidden="true"
					/>
					<span className="space-y-1">
						<span className="block text-sm font-medium">
							Connect a monitoring tool instead
						</span>
						<span className="block text-sm text-muted-foreground">
							Point Prometheus, Datadog or a generic webhook at PrismaLens and
							let real alerts correlate into incidents.
						</span>
					</span>
				</Link>
			</CardContent>

			<CardFooter className="justify-end">
				<Button variant="outline" onClick={onComplete}>
					Finish setup
				</Button>
			</CardFooter>
		</Card>
	);
}
