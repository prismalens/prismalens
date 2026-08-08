// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import type { SetupStep } from "@prismalens/contracts";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type { SetupStep };

interface StepConfig {
	id: Exclude<SetupStep, "complete">;
	title: string;
	description: string;
}

/**
 * Ordered to match the contract's `SETUP_STEP_ORDER` — the server decides which
 * step you resume on, this only draws it.
 */
export const SETUP_STEPS: StepConfig[] = [
	{
		id: "account",
		title: "Account",
		description: "Administrator account",
	},
	{
		id: "ai_provider",
		title: "AI Provider",
		description: "Model that runs investigations",
	},
	{
		id: "code_location",
		title: "Code Location",
		description: "Checkout to investigate in",
	},
	{
		id: "first_incident",
		title: "First Incident",
		description: "Something to investigate",
	},
];

export interface SetupProgressProps {
	currentStep: SetupStep;
	steps?: StepConfig[];
	/** Which steps the server reports as already satisfied. */
	completed?: Partial<Record<Exclude<SetupStep, "complete">, boolean>>;
}

export function SetupProgress({
	currentStep,
	steps = SETUP_STEPS,
	completed,
}: SetupProgressProps) {
	// "complete" is past the last step, not one of them, so it must tick every
	// circle rather than falling through findIndex's -1.
	const currentStepIndex =
		currentStep === "complete"
			? steps.length
			: steps.findIndex((s) => s.id === currentStep);

	return (
		<div className="mb-8">
			<div className="flex items-center justify-center">
				{steps.map((step, index) => {
					const isDone = completed?.[step.id] ?? index < currentStepIndex;
					const isCurrent = index === currentStepIndex;
					return (
						<div key={step.id} className="flex items-center">
							<div className="flex flex-col items-center">
								<div
									aria-current={isCurrent ? "step" : undefined}
									// The tick is derived server-side, so it is the visible
									// proof that resume state is real — the e2e spec reads it.
									data-step={step.id}
									data-complete={isDone}
									className={cn(
										"w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium border-2 transition-colors",
										isDone
											? "bg-primary border-primary text-primary-foreground"
											: isCurrent
												? "border-primary text-primary"
												: "border-muted text-muted-foreground",
									)}
								>
									{isDone ? <Check className="h-5 w-5" /> : index + 1}
								</div>
								<div className="mt-2 text-center">
									<p
										className={cn(
											"text-sm font-medium",
											isDone || isCurrent
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
										"w-10 sm:w-16 h-0.5 mx-2 mt-[-1.5rem]",
										isDone ? "bg-primary" : "bg-muted",
									)}
								/>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}
