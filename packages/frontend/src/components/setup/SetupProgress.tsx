"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type SetupStep = "account" | "complete";

interface StepConfig {
	id: SetupStep;
	title: string;
	description: string;
}

const SETUP_STEPS: StepConfig[] = [
	{
		id: "account",
		title: "Create Account",
		description: "Administrator account",
	},
];

export interface SetupProgressProps {
	currentStep: SetupStep;
	steps?: StepConfig[];
}

export function SetupProgress({
	currentStep,
	steps = SETUP_STEPS,
}: SetupProgressProps) {
	const currentStepIndex = steps.findIndex((s) => s.id === currentStep);

	return (
		<div className="mb-8">
			<div className="flex items-center justify-center">
				{steps.map((step, index) => (
					<div key={step.id} className="flex items-center">
						<div className="flex flex-col items-center">
							<div
								className={cn(
									"w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium border-2 transition-colors",
									index < currentStepIndex
										? "bg-primary border-primary text-primary-foreground"
										: index === currentStepIndex
											? "border-primary text-primary"
											: "border-muted text-muted-foreground",
								)}
							>
								{index < currentStepIndex ? (
									<Check className="h-5 w-5" />
								) : (
									index + 1
								)}
							</div>
							<div className="mt-2 text-center">
								<p
									className={cn(
										"text-sm font-medium",
										index <= currentStepIndex
											? "text-foreground"
											: "text-muted-foreground",
									)}
								>
									{step.title}
								</p>
								<p className="text-xs text-muted-foreground hidden sm:block">
									{step.description}
								</p>
							</div>
						</div>
						{index < steps.length - 1 && (
							<div
								className={cn(
									"w-16 sm:w-24 h-0.5 mx-2 mt-[-1.5rem]",
									index < currentStepIndex ? "bg-primary" : "bg-muted",
								)}
							/>
						)}
					</div>
				))}
			</div>
		</div>
	);
}
