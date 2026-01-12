import { createFileRoute } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/settings/")({
	component: SettingsPage,
});

function SettingsPage() {
	return (
		<div className="px-4 py-6 sm:px-0">
			<h1 className="text-3xl font-bold text-foreground mb-8">Settings</h1>

			<div className="space-y-6">
				{/* LLM Configuration */}
				<Card>
					<CardHeader>
						<CardTitle>LLM Configuration</CardTitle>
						<CardDescription>
							Configure your preferred LLM provider. PrismaLens supports
							multiple providers via LiteLLM.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="provider">Provider</Label>
							<Select defaultValue="google">
								<SelectTrigger id="provider">
									<SelectValue placeholder="Select provider" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="google">Google (Gemini)</SelectItem>
									<SelectItem value="openai">OpenAI (GPT-4)</SelectItem>
									<SelectItem value="anthropic">Anthropic (Claude)</SelectItem>
									<SelectItem value="azure">Azure OpenAI</SelectItem>
									<SelectItem value="ollama">Ollama (Local)</SelectItem>
								</SelectContent>
							</Select>
						</div>

						<div className="space-y-2">
							<Label htmlFor="model">Model</Label>
							<Input
								id="model"
								type="text"
								placeholder="gemini-2.0-flash"
								defaultValue="gemini-2.0-flash"
							/>
						</div>

						<div className="space-y-2">
							<Label htmlFor="api-key">API Key</Label>
							<Input
								id="api-key"
								type="password"
								placeholder="Enter your API key"
							/>
							<p className="text-xs text-muted-foreground">
								Your API key is stored securely and never shared.
							</p>
						</div>
					</CardContent>
				</Card>

				{/* Integrations */}
				<Card>
					<CardHeader>
						<CardTitle>Integrations</CardTitle>
					</CardHeader>
					<CardContent className="space-y-4">
						<IntegrationCard
							name="GitHub"
							description="Connect to analyze code and git history"
							connected={true}
						/>
						<IntegrationCard
							name="Render"
							description="Collect logs from Render.com services"
							connected={false}
						/>
						<IntegrationCard
							name="Prometheus"
							description="Query metrics and alerts"
							connected={false}
						/>
					</CardContent>
				</Card>

				{/* Danger Zone */}
				<Card className="border-destructive/50">
					<CardHeader>
						<CardTitle className="text-destructive">Danger Zone</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="flex justify-between items-center">
							<div>
								<h3 className="font-medium text-foreground">
									Clear Investigation History
								</h3>
								<p className="text-sm text-muted-foreground">
									Delete all investigation data. This action cannot be undone.
								</p>
							</div>
							<Button variant="destructive">Clear All</Button>
						</div>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}

function IntegrationCard({
	name,
	description,
	connected,
}: {
	name: string;
	description: string;
	connected: boolean;
}) {
	return (
		<div className="flex justify-between items-center p-4 border border-border rounded-lg">
			<div>
				<h3 className="font-medium text-foreground">{name}</h3>
				<p className="text-sm text-muted-foreground">{description}</p>
			</div>
			{connected ? (
				<Badge
					variant="secondary"
					className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
				>
					Connected
				</Badge>
			) : (
				<Button variant="outline">Connect</Button>
			)}
		</div>
	);
}
