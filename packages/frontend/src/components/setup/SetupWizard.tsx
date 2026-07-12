// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import { useNavigate } from "@tanstack/react-router";
import { CheckCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { SetupProgress, type SetupStep } from "./SetupProgress";
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
	const _navigate = useNavigate();
	const [currentStep, setCurrentStep] = useState<SetupStep>(initialStep);

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

	const handleComplete = () => {
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

	return (
		<div className="min-h-[80vh] flex items-center justify-center py-8">
			<div className="w-full max-w-2xl px-4">
				<SetupProgress currentStep={currentStep} />

				{currentStep === "account" && (
					<SetupStepOwner onComplete={handleComplete} />
				)}

				<p className="text-center text-sm text-muted-foreground mt-6">
					PrismaLens Community Edition - Unlimited users, unlimited features
				</p>
			</div>
		</div>
	);
}
