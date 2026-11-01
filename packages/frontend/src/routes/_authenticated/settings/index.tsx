import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useEffect } from "react";
import {
	AboutSettings,
	AlertIntakeSettings,
	HarnessSettings,
	NotificationsSettings,
	TelemetrySettings,
} from "@/components/settings";
import { AgentDetail } from "@/components/settings/AgentDetail";
import { AppearanceSettings } from "@/components/settings/AppearanceSettings";
import { DevicesTab } from "@/components/settings/DevicesTab";
import { GeneralSettings } from "@/components/settings/GeneralSettings";
import { RunWorkspaceSettings } from "@/components/settings/RunWorkspaceSettings";
import {
	FIRST_SETTINGS_TAB,
	SETTINGS_SECTIONS,
	SettingsFrame,
	type SettingsTab,
} from "@/components/settings/SettingsFrame";
import {
	AddSourceButton,
	MANY_SOURCES,
	SourcesSettings,
} from "@/components/settings/SourcesSettings";
import { Pool, Row } from "@/components/shared/Row";
import { PageHeader } from "@/components/shell/PageHeader";
import { PHONE, useMediaQuery } from "@/hooks/use-media-query";
import { useSourcesOverview } from "@/lib/api/hooks/use-sources-orpc";
import { orpc } from "@/lib/api/orpc-client";

export const Route = createFileRoute("/_authenticated/settings/")({
	component: SettingsPage,
});

const SECTIONS: Record<SettingsTab, { title: string; intro?: string }> = {
	general: { title: "General" },
	appearance: { title: "Appearance" },
	agent: {
		title: "Agent",
		intro:
			"The coding agent a run uses to read the code and the telemetry. It signs in on its own. Variables you add under an agent are stored encrypted and passed only to that agent.",
	},
	runs: {
		title: "Runs",
		intro:
			"Where a run checks out the code, and what is left of it afterwards.",
	},
	"alert-intake": {
		title: "Alert intake",
		intro: "What starts an investigation.",
	},
	sources: { title: "Sources", intro: "What a run reads before it starts." },
	notifications: { title: "Notifications", intro: "Where findings go." },
	devices: {
		title: "Devices",
		intro: "Phones and computers paired with this instance.",
	},
	usage: {
		title: "Usage data",
		intro:
			"Counts that show which features get used. On unless you turn it off.",
	},
	about: { title: "About" },
};

function SettingsPage() {
	const {
		tab: picked,
		agent,
		source,
	} = useSearch({
		from: "/_authenticated/settings",
	});
	const tab = picked ?? FIRST_SETTINGS_TAB;
	const phone = useMediaQuery(PHONE);
	const queryClient = useQueryClient();
	const sources = useSourcesOverview(tab === "sources");
	const manySources =
		(sources.data?.sources.length ?? 0) + (sources.data?.gitHosts.length ?? 0) >
		MANY_SOURCES;

	// Actions on other screens change what these sections show; refetch on entry.
	useEffect(() => {
		queryClient.invalidateQueries({ queryKey: orpc.integrations.key() });
		queryClient.invalidateQueries({ queryKey: orpc.settings.key() });
	}, [queryClient]);

	// On the phone Settings lands on its sections; one opens, the Settings door returns here.
	if (phone && !picked) return <SectionList />;

	const section = SECTIONS[tab];
	return (
		<SettingsFrame
			section={tab}
			title={section.title}
			intro={section.intro}
			actions={tab === "sources" ? <AddSourceButton /> : undefined}
			wide={tab === "sources" && manySources}
		>
			{tab === "general" && <GeneralSettings />}
			{tab === "appearance" && <AppearanceSettings />}
			{tab === "agent" &&
				(agent ? <AgentDetail id={agent} /> : <HarnessSettings />)}
			{tab === "runs" && <RunWorkspaceSettings />}
			{tab === "alert-intake" && <AlertIntakeSettings />}
			{tab === "sources" && <SourcesSettings source={source} />}
			{tab === "notifications" && <NotificationsSettings />}
			{tab === "devices" && <DevicesTab />}
			{tab === "usage" && <TelemetrySettings />}
			{tab === "about" && <AboutSettings />}
		</SettingsFrame>
	);
}

/**
 * The phone's landing: each page in one pool, flat (#848). The strip's
 * Settings door (Sidebar.tsx) returns a page here.
 */
function SectionList() {
	return (
		<div
			className="flex h-full flex-col bg-canvas"
			data-testid="settings-frame"
		>
			<PageHeader title="Settings" />
			<nav
				className="min-h-0 flex-1 overflow-y-auto px-4 pt-2 pb-12"
				aria-label="Settings sections"
				data-testid="settings-section-list"
			>
				<Pool>
					{SETTINGS_SECTIONS.map((s) => (
						<Row
							key={s.tab}
							className="relative min-h-14"
							label={
								<Link
									to="/settings"
									search={{ tab: s.tab }}
									className="after:absolute after:inset-0"
									data-testid={`settings-section-${s.tab}`}
								>
									{s.label}
								</Link>
							}
							trailing={<ChevronRight className="size-4 text-text-3" />}
						/>
					))}
				</Pool>
			</nav>
		</div>
	);
}
