// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

/**
 * The first-run wizard (#332).
 *
 * Four steps, and the one you land on is the server's answer, not this
 * component's memory: `/setup`'s loader seeds `initialStep` from
 * `setup.getStatus`, which derives it from durable state. Reload mid-flow,
 * close the tab, come back tomorrow on another machine — you resume on the
 * first thing that is genuinely still missing.
 *
 * Steps after the account need an authenticated session, because they call
 * authenticated endpoints (`/settings/llm/*`, `/services/*`). If the browser
 * has no session yet the wizard says so and hands off to sign-in with a
 * `redirect` back here, rather than firing requests that 401 and look like
 * broken steps.
 */

import { SETUP_STEP_ORDER, type SetupStep } from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import { CheckCircle, LogIn } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { useSetupStatus } from "@/lib/api/hooks";
import { useSession } from "@/lib/auth";
import { SetupProgress } from "./SetupProgress";
import { SetupStepAIProvider } from "./SetupStepAIProvider";
import { SetupStepCodeLocation } from "./SetupStepCodeLocation";
import { SetupStepFirstIncident } from "./SetupStepFirstIncident";
import { SetupStepOwner } from "./SetupStepOwner";

export interface SetupWizardProps {
	/** Redirect URL after setup completes */
	redirect?: string;
	/** Initial step to start from (used when resuming setup) */
	initialStep?: SetupStep;
}

export function SetupWizard({
	redirect,
	initialStep = "account",
}: SetupWizardProps) {
	const [currentStep, setCurrentStep] = useState<SetupStep>(initialStep);
	const { data: status, refetch: refetchStatus } = useSetupStatus();
	const { data: session, isPending: sessionPending } = useSession();

	const getRedirectDestination = () => {
		if (redirect) {
			try {
				const url = new URL(redirect, window.location.origin);
				return url.pathname;
			} catch {
				return "/";
			}
		}
		return "/";
	};

	/** Move to the next step in contract order, or finish. */
	const advanceFrom = (step: SetupStep) => {
		const index = SETUP_STEP_ORDER.indexOf(
			step as Exclude<SetupStep, "complete">,
		);
		const next = index >= 0 ? SETUP_STEP_ORDER[index + 1] : undefined;
		setCurrentStep(next ?? "complete");
	};

	/**
	 * A step finished. Refresh the derived status first so the progress bar
	 * ticks from the server's view rather than from optimism, then advance.
	 */
	const handleStepDone = async (step: SetupStep) => {
		await refetchStatus();
		advanceFrom(step);
	};

	const handleFinish = () => {
		setCurrentStep("complete");
		const destination = getRedirectDestination();
		setTimeout(() => {
			window.location.href = destination;
		}, 2000);
	};

	if (currentStep === "complete") {
		const destination = getRedirectDestination();
		return (
			<div className="min-h-[80vh] flex items-center justify-center">
				<div className="w-full max-w-md">
					<Card className="text-center">
						<CardHeader>
							<div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
								<CheckCircle className="h-8 w-8 text-green-600 dark:text-green-400" />
							</div>
							<CardTitle className="text-2xl">Setup Complete!</CardTitle>
							<CardDescription>
								PrismaLens is ready to help you investigate incidents
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<p className="text-muted-foreground">Redirecting...</p>
							<Button
								onClick={() => {
									window.location.href = destination;
								}}
							>
								Continue
							</Button>
						</CardContent>
					</Card>
				</div>
			</div>
		);
	}

	// Everything past the account step talks to authenticated endpoints.
	const needsSession =
		currentStep !== "account" && !sessionPending && !session?.user;

	return (
		<div className="min-h-[80vh] flex items-center justify-center py-8">
			<div className="w-full max-w-2xl px-4">
				<SetupProgress
					currentStep={currentStep}
					completed={
						status
							? {
									account: status.steps.owner,
									ai_provider: status.steps.aiProvider,
									code_location: status.steps.codeLocation,
									first_incident: status.steps.firstIncident,
								}
							: undefined
					}
				/>

				{needsSession ? (
					<Card>
						<CardHeader className="text-center">
							<div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
								<LogIn className="h-8 w-8 text-primary" />
							</div>
							<CardTitle>
								<h2>Sign in to continue setup</h2>
							</CardTitle>
							<CardDescription>
								Your administrator account exists. The remaining steps configure
								this instance, so they need you signed in. You will come
								straight back here.
							</CardDescription>
						</CardHeader>
						<CardContent className="flex justify-center">
							<Button asChild>
								<Link to="/auth/login" search={{ redirect: "/setup" }}>
									Sign in
								</Link>
							</Button>
						</CardContent>
					</Card>
				) : (
					<>
						{currentStep === "account" && (
							<SetupStepOwner onComplete={() => handleStepDone("account")} />
						)}

						{currentStep === "ai_provider" && (
							<SetupStepAIProvider
								onComplete={() => handleStepDone("ai_provider")}
								onSkip={() => advanceFrom("ai_provider")}
							/>
						)}

						{currentStep === "code_location" && (
							<SetupStepCodeLocation
								onComplete={() => handleStepDone("code_location")}
								onSkip={() => advanceFrom("code_location")}
							/>
						)}

						{currentStep === "first_incident" && (
							<SetupStepFirstIncident onComplete={handleFinish} />
						)}
					</>
				)}

				<div className="mt-6 flex items-center justify-center gap-3 text-sm text-muted-foreground">
					<span>
						PrismaLens Community Edition - Unlimited users, unlimited features
					</span>
					{currentStep !== "account" && (
						<Button
							variant="link"
							size="sm"
							className="h-auto p-0 text-sm"
							onClick={() => {
								// A full navigation, not a router push: the destination is a
								// runtime string from `?redirect=`, which the typed router
								// cannot accept as a route literal.
								window.location.href = getRedirectDestination();
							}}
						>
							Skip setup
						</Button>
					)}
				</div>
			</div>
		</div>
	);
}
