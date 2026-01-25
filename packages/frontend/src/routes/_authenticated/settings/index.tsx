"use client";

import { createFileRoute } from "@tanstack/react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
	AIProviderSettings,
	DangerZoneSettings,
	IntegrationsSettings,
	InvestigationSettings,
	MCPServerSettings,
} from "@/components/settings";

export const Route = createFileRoute("/_authenticated/settings/")({
	component: SettingsPage,
});

function SettingsPage() {
	return (
		<div className="px-4 py-6 sm:px-0">
			<h1 className="text-3xl font-bold text-foreground mb-8">Settings</h1>

			<Tabs defaultValue="ai" className="space-y-6">
				<TabsList>
					<TabsTrigger value="ai">AI Provider</TabsTrigger>
					<TabsTrigger value="mcp">MCP Servers</TabsTrigger>
					<TabsTrigger value="investigation">Investigation</TabsTrigger>
					<TabsTrigger value="integrations">Integrations</TabsTrigger>
					<TabsTrigger value="danger">Danger Zone</TabsTrigger>
				</TabsList>

				<TabsContent value="ai">
					<AIProviderSettings />
				</TabsContent>

				<TabsContent value="mcp">
					<MCPServerSettings />
				</TabsContent>

				<TabsContent value="investigation">
					<InvestigationSettings />
				</TabsContent>

				<TabsContent value="integrations">
					<IntegrationsSettings />
				</TabsContent>

				<TabsContent value="danger">
					<DangerZoneSettings />
				</TabsContent>
			</Tabs>
		</div>
	);
}
