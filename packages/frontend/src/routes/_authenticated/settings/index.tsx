"use client";

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
	AIProviderSettings,
	DangerZoneSettings,
	IntegrationsSettings,
	InvestigationSettings,
} from "@/components/settings";
import { PageHeader } from "@/components/layout";
import { cn } from "@/lib/utils";

type SettingsTab = "ai" | "investigation" | "integrations" | "danger";

const TABS: { value: SettingsTab; label: string }[] = [
	{ value: "ai", label: "AI Provider" },
	{ value: "investigation", label: "Investigation" },
	{ value: "integrations", label: "Integrations" },
	{ value: "danger", label: "Danger Zone" },
];

export const Route = createFileRoute("/_authenticated/settings/")({
	validateSearch: (search: Record<string, unknown>) => ({
		tab: (TABS.some((t) => t.value === search.tab)
			? (search.tab as SettingsTab)
			: "ai") as SettingsTab,
	}),
	component: SettingsPage,
});

function SettingsPage() {
	const { tab } = Route.useSearch();
	const navigate = useNavigate({ from: "/settings" });

	return (
		<div className="px-4 py-6 sm:px-0">
			<div className="mb-6">
				<PageHeader title="Settings" />
			</div>

			<div className="flex gap-8">
				{/* Sidebar Navigation */}
				<nav className="w-48 flex-shrink-0">
					<ul className="space-y-1">
						{TABS.map((t) => (
							<li key={t.value}>
								<button
									type="button"
									onClick={() =>
										navigate({ search: { tab: t.value } })
									}
									className={cn(
										"w-full text-left text-sm px-3 py-2 rounded-md transition-colors",
										tab === t.value
											? "bg-accent text-accent-foreground font-medium"
											: "text-muted-foreground hover:text-foreground hover:bg-muted",
									)}
								>
									{t.label}
								</button>
							</li>
						))}
					</ul>
				</nav>

				{/* Content */}
				<div className="flex-1 min-w-0">
					{tab === "ai" && <AIProviderSettings />}
					{tab === "investigation" && <InvestigationSettings />}
					{tab === "integrations" && <IntegrationsSettings />}
					{tab === "danger" && <DangerZoneSettings />}
				</div>
			</div>
		</div>
	);
}
