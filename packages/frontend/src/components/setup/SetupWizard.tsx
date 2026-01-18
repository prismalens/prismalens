"use client";

import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { CheckCircle } from "lucide-react";
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
import { SetupStepLLM } from "./SetupStepLLM";
import { SetupStepIntegrations } from "./SetupStepIntegrations";

export interface SetupWizardProps {
	/** Initial search params from OAuth callback or redirect */
	searchParams?: {
		callback?: boolean;
		provider?: string;
		success?: string;
		redirect?: string;
	};
	/** Initial step to start from (used when resuming setup) */
	initialStep?: SetupStep;
}

export function SetupWizard({ searchParams, initialStep = "account" }: SetupWizardProps) {
	const navigate = useNavigate();
	const [currentStep, setCurrentStep] = useState<SetupStep>(initialStep);
	const [connectedIntegrations, setConnectedIntegrations] = useState<string[]>(
		[],
	);
	// Store redirect URL to use after setup completion
	const [redirectUrl] = useState(searchParams?.redirect);

	// Handle OAuth callback
	useEffect(() => {
		if (searchParams?.callback) {
			setCurrentStep("integration");

			// Check if OAuth was successful
			const provider = searchParams.provider;
			if (searchParams.success === "true" && provider) {
				setConnectedIntegrations((prev) =>
					prev.includes(provider) ? prev : [...prev, provider],
				);
			}

			// Clean up URL params by navigating without search params (preserve redirect)
			navigate({
				to: "/setup",
				search: {
					callback: false,
					provider: undefined,
					success: undefined,
					redirect: redirectUrl,
				},
				replace: true,
			});
		}
	}, [searchParams?.callback, searchParams?.success, searchParams?.provider, navigate, redirectUrl]);

	// Determine where to navigate after setup completion
	const getRedirectDestination = () => {
		if (redirectUrl) {
			// Parse the redirect URL to get just the pathname
			try {
				const url = new URL(redirectUrl, window.location.origin);
				return url.pathname;
			} catch {
				return "/";
			}
		}
		return "/";
	};

	const handleComplete = () => {
		setCurrentStep("complete");
		// Auto-redirect after showing success
		const destination = getRedirectDestination();
		setTimeout(() => {
			// Use window.location for full URL redirects to ensure route guards run
			window.location.href = destination;
		}, 2000);
	};

	// Render complete state
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
				{/* Stepper */}
				<SetupProgress currentStep={currentStep} />

				{/* Step 1: Create Account */}
				{currentStep === "account" && (
					<SetupStepOwner onComplete={() => setCurrentStep("ai")} />
				)}

				{/* Step 2: Configure AI Provider */}
				{currentStep === "ai" && (
					<SetupStepLLM onComplete={() => setCurrentStep("integration")} />
				)}

				{/* Step 3: Connect Integration */}
				{currentStep === "integration" && (
					<SetupStepIntegrations
						onComplete={handleComplete}
						connectedIntegrations={connectedIntegrations}
					/>
				)}

				{/* Footer */}
				<p className="text-center text-sm text-muted-foreground mt-6">
					PrismaLens Community Edition - Unlimited users, unlimited features
				</p>
			</div>
		</div>
	);
}
