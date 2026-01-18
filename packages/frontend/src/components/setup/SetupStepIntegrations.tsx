"use client";

import { useState } from "react";
import {
	Check,
	CheckCircle,
	ChevronRight,
	Github,
	Loader2,
	type LucideIcon,
	MessageSquare,
	Webhook,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { useMarkStepSkipped } from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

interface Integration {
	id: string;
	name: string;
	description: string;
	icon: LucideIcon;
	method: "oauth" | "webhook";
}

const INTEGRATIONS: Integration[] = [
	{
		id: "github",
		name: "GitHub",
		description: "Code context, commits, PRs",
		icon: Github,
		method: "oauth",
	},
	{
		id: "prometheus",
		name: "Prometheus",
		description: "Metrics & alerting",
		icon: Webhook,
		method: "webhook",
	},
	{
		id: "slack",
		name: "Slack",
		description: "Notifications & alerts",
		icon: MessageSquare,
		method: "oauth",
	},
];

export interface SetupStepIntegrationsProps {
	onComplete: () => void;
	onSkip?: () => void;
	/** Pre-connected integrations from OAuth callback */
	connectedIntegrations?: string[];
}

export function SetupStepIntegrations({
	onComplete,
	onSkip,
	connectedIntegrations: initialConnected = [],
}: SetupStepIntegrationsProps) {
	const [selectedIntegration, setSelectedIntegration] = useState<string | null>(
		null,
	);
	const [connectedIntegrations] = useState<string[]>(initialConnected);
	const [error, setError] = useState<string | null>(null);

	// oRPC mutations
	const markSkipped = useMarkStepSkipped();

	const handleConnect = (integrationId: string) => {
		const integration = INTEGRATIONS.find((i) => i.id === integrationId);
		if (!integration) return;

		if (integration.method === "oauth") {
			// Start OAuth flow - redirect to authorization endpoint
			const redirectUri = `${window.location.origin}/setup?callback=true`;
			const oauthUrl = `/api/integrations/oauth/${integrationId}/authorize?name=${encodeURIComponent(integration.name)}&redirect_uri=${encodeURIComponent(redirectUri)}`;
			window.location.href = oauthUrl;
		} else {
			// For API-key/webhook integrations, just mark as selected
			// In a full implementation, this would show a modal for credentials
			setSelectedIntegration(integrationId);
		}
	};

	const handleFinish = async () => {
		// If no integrations connected, mark as skipped before completing
		// This ensures the step is tracked as complete in the database
		if (connectedIntegrations.length === 0) {
			try {
				await markSkipped.mutateAsync({ step: "integration" });
			} catch {
				// Ignore error, proceed to complete anyway
			}
		}
		onComplete();
	};

	const handleSkip = async () => {
		try {
			await markSkipped.mutateAsync({ step: "integration" });
			onSkip?.();
			onComplete();
		} catch (err) {
			const message =
				err instanceof Error ? err.message : "Failed to skip step";
			setError(message);
		}
	};

	return (
		<Card>
			<CardHeader className="text-center">
				<div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
					<Webhook className="h-8 w-8 text-primary" />
				</div>
				<CardTitle>Connect Your First Tool</CardTitle>
				<CardDescription>
					Optional: Connect a tool to give PrismaLens context for analysis
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-6">
				<div className="grid gap-4">
					{INTEGRATIONS.map((integration) => {
						const Icon = integration.icon;
						const isConnected = connectedIntegrations.includes(integration.id);
						const isSelected = selectedIntegration === integration.id;

						return (
							<div
								key={integration.id}
								className={cn(
									"p-4 rounded-lg border-2 transition-colors",
									isConnected
										? "border-green-500 bg-green-50 dark:bg-green-900/20"
										: isSelected
											? "border-primary bg-primary/5"
											: "border-muted",
								)}
							>
								<div className="flex items-center justify-between">
									<div className="flex items-center gap-3">
										<div
											className={cn(
												"w-10 h-10 rounded-lg flex items-center justify-center",
												isConnected
													? "bg-green-100 dark:bg-green-900/40"
													: "bg-muted",
											)}
										>
											<Icon
												className={cn(
													"h-5 w-5",
													isConnected && "text-green-600 dark:text-green-400",
												)}
											/>
										</div>
										<div>
											<p className="font-medium">{integration.name}</p>
											<p className="text-sm text-muted-foreground">
												{integration.description}
											</p>
										</div>
									</div>
									{isConnected ? (
										<div className="flex items-center gap-2 text-green-600 dark:text-green-400">
											<CheckCircle className="h-5 w-5" />
											<span className="text-sm font-medium">Connected</span>
										</div>
									) : (
										<Button
											variant={isSelected ? "default" : "outline"}
											size="sm"
											onClick={() => handleConnect(integration.id)}
										>
											{isSelected ? (
												<>
													<Check className="mr-1 h-4 w-4" />
													Selected
												</>
											) : (
												"Connect"
											)}
										</Button>
									)}
								</div>
							</div>
						);
					})}
				</div>

				{error && (
					<p className="text-sm text-destructive text-center">{error}</p>
				)}

				<p className="text-sm text-muted-foreground text-center">
					You can add more integrations later in Settings.
				</p>

				<div className="flex gap-3">
					<Button
						variant="outline"
						onClick={handleSkip}
						disabled={markSkipped.isPending}
					>
						{markSkipped.isPending ? (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						) : null}
						Skip for now
					</Button>
					<Button className="flex-1" onClick={handleFinish}>
						Go to Dashboard
						<ChevronRight className="ml-2 h-4 w-4" />
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}
