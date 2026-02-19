"use client";

import { MCP_SERVERS, type MCPServerId } from "@prismalens/config/mcp";
import {
	AlertCircle,
	CheckCircle,
	ExternalLink,
	Info,
	Link2,
	Loader2,
	Server,
	Shield,
	Unplug,
} from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
	useMcpSettings,
	useMcpStatus,
	useTestMcpConnection,
	useUpdateMcpSettings,
} from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

// Transform MCP_SERVERS from config into UI-friendly format
const SERVERS = Object.values(MCP_SERVERS).map((server) => ({
	id: server.id as MCPServerId,
	name: server.name,
	description: server.description,
	helpUrl: server.helpUrl,
	integrationType: server.integrationType,
	suggestedTools: server.suggestedTools,
}));

export function MCPServerSettings() {
	const { data: settings, isLoading: settingsLoading } = useMcpSettings();
	const { data: status, isLoading: statusLoading } = useMcpStatus();
	const updateSettings = useUpdateMcpSettings();
	const testConnection = useTestMcpConnection();

	// Test status per server
	const [testStatuses, setTestStatuses] = useState<
		Record<string, "idle" | "testing" | "success" | "error">
	>({});
	const [testErrors, setTestErrors] = useState<Record<string, string>>({});

	const handleToggleEnabled = async (serverId: MCPServerId, enabled: boolean) => {
		await updateSettings.mutateAsync({
			servers: {
				[serverId]: { enabled },
			},
		});
	};

	const handleToggleReadOnly = async (
		serverId: MCPServerId,
		readOnlyMode: boolean,
	) => {
		await updateSettings.mutateAsync({
			servers: {
				[serverId]: { readOnlyMode },
			},
		});
	};

	const handleTestConnection = async (serverId: MCPServerId) => {
		setTestStatuses((prev) => ({ ...prev, [serverId]: "testing" }));
		setTestErrors((prev) => {
			const next = { ...prev };
			delete next[serverId];
			return next;
		});

		try {
			const result = await testConnection.mutateAsync({ serverId });

			if (result.success) {
				setTestStatuses((prev) => ({ ...prev, [serverId]: "success" }));
			} else {
				setTestStatuses((prev) => ({ ...prev, [serverId]: "error" }));
				setTestErrors((prev) => ({
					...prev,
					[serverId]: result.error || "Connection test failed",
				}));
			}
		} catch (err) {
			setTestStatuses((prev) => ({ ...prev, [serverId]: "error" }));
			setTestErrors((prev) => ({
				...prev,
				[serverId]: err instanceof Error ? err.message : "Connection test failed",
			}));
		}
	};

	const isLoading = settingsLoading || statusLoading;

	if (isLoading) {
		return (
			<Card>
				<CardContent className="flex items-center justify-center py-12">
					<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
				</CardContent>
			</Card>
		);
	}

	// Count ready servers
	const readyCount = status?.servers.filter((s) => s.isReady).length || 0;
	const totalCount = status?.servers.length || 0;

	return (
		<div className="space-y-6">
			{/* Info Alert */}
			<Alert>
				<Info className="h-4 w-4" />
				<AlertTitle>Model Context Protocol (MCP) Servers</AlertTitle>
				<AlertDescription>
					MCP servers provide agents with access to external systems during
					investigations. Enable servers to let agents search code, view logs,
					and gather context from your integrations.
					<a
						href="https://github.com/prismalens-org/prismalens#mcp-servers"
						target="_blank"
						rel="noopener noreferrer"
						className="ml-1 text-primary hover:underline inline-flex items-center gap-1"
					>
						Learn more <ExternalLink className="h-3 w-3" />
					</a>
				</AlertDescription>
			</Alert>

			{/* Main Card */}
			<Card>
				<CardHeader>
					<div className="flex items-center gap-3">
						<div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
							<Server className="h-5 w-5 text-primary" />
						</div>
						<div className="flex-1">
							<CardTitle>MCP Server Configuration</CardTitle>
							<CardDescription>
								Configure which MCP servers agents can use during investigations
							</CardDescription>
						</div>
						<Badge variant="secondary">
							{readyCount}/{totalCount} Ready
						</Badge>
					</div>
				</CardHeader>
				<CardContent className="space-y-4">
					{SERVERS.map((server) => {
						const serverStatus = status?.servers.find(
							(s) => s.serverId === server.id,
						);
						const serverSettings = settings?.servers[server.id];
						const isEnabled = serverSettings?.enabled ?? true;
						const isReadOnly = serverSettings?.readOnlyMode ?? true;
						const hasCredentials = serverStatus?.hasCredentials ?? false;
						const isReady = serverStatus?.isReady ?? false;
						const testStatus = testStatuses[server.id] || "idle";
						const testError = testErrors[server.id];

						return (
							<div
								key={server.id}
								className={cn(
									"border rounded-lg p-4 space-y-4 transition-colors",
									!isEnabled && "opacity-60",
								)}
							>
								{/* Server Header */}
								<div className="flex items-start justify-between">
									<div className="space-y-1">
										<div className="flex items-center gap-2">
											<h4 className="font-medium">{server.name}</h4>
											{isReady ? (
												<Badge
													variant="default"
													className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
												>
													<CheckCircle className="h-3 w-3 mr-1" />
													Ready
												</Badge>
											) : hasCredentials ? (
												<Badge variant="secondary">
													<Unplug className="h-3 w-3 mr-1" />
													Disabled
												</Badge>
											) : (
												<Badge variant="outline" className="text-muted-foreground">
													<Link2 className="h-3 w-3 mr-1" />
													No Integration
												</Badge>
											)}
										</div>
										<p className="text-sm text-muted-foreground">
											{server.description}
										</p>
									</div>
									<div className="flex items-center gap-2">
										<Switch
											checked={isEnabled}
											onCheckedChange={(checked: boolean) =>
												handleToggleEnabled(server.id, checked)
											}
											disabled={!hasCredentials}
										/>
									</div>
								</div>

								{/* Configuration Options */}
								{isEnabled && hasCredentials && (
									<div className="flex items-center justify-between pt-2 border-t">
										<div className="flex items-center gap-6">
											{/* Read-Only Toggle */}
											<div className="flex items-center gap-2">
												<Shield className="h-4 w-4 text-muted-foreground" />
												<Label
													htmlFor={`readonly-${server.id}`}
													className="text-sm"
												>
													Read-only mode
												</Label>
												<Switch
													id={`readonly-${server.id}`}
													checked={isReadOnly}
													onCheckedChange={(checked: boolean) =>
														handleToggleReadOnly(server.id, checked)
													}
												/>
											</div>
										</div>

										{/* Test Connection */}
										<div className="flex items-center gap-2">
											{testStatus === "success" && (
												<span className="text-sm text-green-600 dark:text-green-400 flex items-center gap-1">
													<CheckCircle className="h-4 w-4" />
													Connected
												</span>
											)}
											{testStatus === "error" && (
												<span className="text-sm text-destructive flex items-center gap-1">
													<AlertCircle className="h-4 w-4" />
													{testError}
												</span>
											)}
											<Button
												variant="outline"
												size="sm"
												onClick={() => handleTestConnection(server.id)}
												disabled={testStatus === "testing"}
											>
												{testStatus === "testing" ? (
													<>
														<Loader2 className="h-3 w-3 mr-1 animate-spin" />
														Testing...
													</>
												) : (
													"Test Connection"
												)}
											</Button>
										</div>
									</div>
								)}

								{/* No Integration Warning */}
								{!hasCredentials && (
									<div className="text-sm text-muted-foreground bg-muted/50 rounded p-3">
										Configure a {server.integrationType} integration in the
										Integrations section to enable this MCP server.
									</div>
								)}

								{/* Tools Preview */}
								{isEnabled && hasCredentials && server.suggestedTools.length > 0 && (
									<div className="pt-2">
										<p className="text-xs text-muted-foreground mb-2">
											Available tools ({server.suggestedTools.length}):
										</p>
										<div className="flex flex-wrap gap-1">
											{server.suggestedTools.slice(0, 6).map((tool) => (
												<Badge
													key={tool}
													variant="outline"
													className="text-xs font-mono"
												>
													{tool}
												</Badge>
											))}
											{server.suggestedTools.length > 6 && (
												<Badge variant="outline" className="text-xs">
													+{server.suggestedTools.length - 6} more
												</Badge>
											)}
										</div>
									</div>
								)}
							</div>
						);
					})}
				</CardContent>
			</Card>
		</div>
	);
}
