// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	BUILTIN_SOURCES,
	type ConnectStep,
	connectSteps,
	type SourceCategoryView,
} from "@prismalens/contracts/schemas";
import { useEffect, useState } from "react";
import { Mono } from "@/components/shared/Mono";
import { MutationError } from "@/components/shared/MutationError";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useSetRunbooks } from "@/lib/api/hooks/use-sources-orpc";

const RUNBOOKS = BUILTIN_SOURCES.find((b) => b.id === "runbooks");

/**
 * Runbooks in the bound repos (#848): nothing to fill in. Step one is the toggle,
 * step two confirms what was found and which read-only tools the agent gets.
 */
export function RunbooksDialog({
	source,
	open,
	onOpenChange,
}: {
	source?: SourceCategoryView["sources"][number];
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const steps = RUNBOOKS ? connectSteps(RUNBOOKS) : [];
	const off = source?.reason === "Turned off.";
	const [step, setStep] = useState<ConnectStep>("toggle");
	const [enabled, setEnabled] = useState(!off);
	const save = useSetRunbooks();
	const { toast } = useToast();

	useEffect(() => {
		if (!open) return;
		setStep("toggle");
		setEnabled(!off);
		save.reset();
	}, [open, off, save.reset]);

	if (!RUNBOOKS) return null;
	const found = source?.status === "connected" && !off;
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent data-testid="runbooks-dialog" className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>
						{RUNBOOKS.label}
						<span
							className="ml-2 font-normal text-meta text-text-3"
							data-testid="connect-step"
						>
							step {steps.indexOf(step) + 1} of {steps.length}
						</span>
					</DialogTitle>
					<DialogDescription>
						{step === "toggle"
							? "Nothing to set up. PrismaLens reads them from the repositories bound to your services."
							: "What the agent gets. Nothing it can call writes."}
					</DialogDescription>
				</DialogHeader>
				{step === "toggle" ? (
					<label className="flex items-center justify-between gap-4 text-body">
						<span>
							Find runbooks in repos bound to services
							<span className="block text-meta text-text-3">
								<Mono>runbooks/</Mono>, <Mono>docs/runbooks/</Mono>,{" "}
								<Mono>RUNBOOK*.md</Mono> and runbook links in{" "}
								<Mono>catalog-info.yaml</Mono>, at the commit each run saw.
							</span>
						</span>
						<Switch
							checked={enabled}
							onCheckedChange={setEnabled}
							data-testid="runbooks-toggle"
						/>
					</label>
				) : (
					<div className="space-y-3 text-body" data-testid="runbooks-confirm">
						<p>
							{enabled ? (
								<>
									Runbook discovery is on.{" "}
									{found && source?.count !== undefined
										? `${source.count} found for the latest run.`
										: found
											? "Repositories are bound to services; the count appears inside a run."
											: (source?.reason ??
												"None found yet in the bound repos.")}
								</>
							) : (
								"Runbook discovery is off. The agent will not see them."
							)}
						</p>
						{enabled && (
							<p>
								The agent can call:{" "}
								{RUNBOOKS.tools.map((t) => (
									<Mono key={t} className="mr-2">
										{t}
									</Mono>
								))}
							</p>
						)}
					</div>
				)}
				<div className="min-h-5">
					<MutationError error={save.error as Error | null} />
				</div>
				<DialogFooter>
					{step === "confirm" && (
						<Button variant="text" onClick={() => setStep("toggle")}>
							Back
						</Button>
					)}
					{step === "toggle" ? (
						<Button
							variant="primary"
							onClick={() => setStep("confirm")}
							data-testid="runbooks-next"
						>
							Next
						</Button>
					) : (
						<Button
							variant="primary"
							disabled={save.isPending}
							data-testid="runbooks-submit"
							onClick={() =>
								save.mutate(
									{ enabled },
									{
										onSuccess: () => {
											toast({
												title: enabled
													? "Runbooks turned on"
													: "Runbooks turned off",
											});
											onOpenChange(false);
										},
									},
								)
							}
						>
							{enabled ? "Connect" : "Save"}
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
