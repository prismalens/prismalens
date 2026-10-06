import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useEffect } from "react";
import {
	AboutSettings,
	DangerZoneSettings,
	HarnessSettings,
	IntegrationsSettings,
	TelemetrySettings,
} from "@/components/settings";
import { AlertSources } from "@/components/settings/AlertSources";
import { DevicesTab } from "@/components/settings/DevicesTab";
import {
	SettingsFrame,
	useSettingsSections,
} from "@/components/settings/SettingsFrame";
import { Pool, Row } from "@/components/shared/Row";
import { PageHeader } from "@/components/shell/PageHeader";
import { PHONE, useMediaQuery } from "@/hooks/use-media-query";
import { orpc } from "@/lib/api/orpc-client";

export const Route = createFileRoute("/_authenticated/settings/")({
	component: SettingsPage,
});

const SECTIONS = {
	harness: {
		title: "Agent",
		intro:
			"The coding agent a run rents to read the code and the telemetry. It signs in on its own; PrismaLens never holds its login.",
	},
	sources: {
		title: "Alert sources",
		intro:
			"Where alerts come from. Alertmanager can push to the webhook, or PrismaLens pulls from a URL.",
	},
	integrations: {
		title: "Integrations",
		intro: "Where the report goes, and which git host holds the code.",
	},
	devices: {
		title: "Devices",
		intro: "Phones and computers paired with this instance.",
	},
	usage: {
		title: "Usage data",
		intro:
			"Counts that show which features get used. Nothing is sent unless you turn it on.",
	},
	about: {
		title: "About",
		intro:
			"Which version this is, how it was installed, and whether a newer release is out.",
	},
	danger: {
		title: "Danger zone",
		intro: "Reset the records, or everything.",
	},
} as const;

function SettingsPage() {
	const { tab: picked } = useSearch({ from: "/_authenticated/settings" });
	const tab = picked ?? "harness";
	const phone = useMediaQuery(PHONE);
	const queryClient = useQueryClient();

	// Actions on other screens change what these sections show; refetch on entry.
	useEffect(() => {
		queryClient.invalidateQueries({ queryKey: orpc.integrations.key() });
		queryClient.invalidateQueries({ queryKey: orpc.settings.key() });
	}, [queryClient]);

	// On the phone Settings lands on its sections; one opens, the Settings door returns here.
	if (phone && !picked) return <SectionList />;

	const section = SECTIONS[tab];
	return (
		<SettingsFrame section={tab} title={section.title} intro={section.intro}>
			{tab === "harness" && <HarnessSettings />}
			{tab === "integrations" && <IntegrationsSettings />}
			{tab === "sources" && <AlertSources />}
			{tab === "devices" && <DevicesTab />}
			{tab === "usage" && <TelemetrySettings />}
			{tab === "about" && <AboutSettings />}
			{tab === "danger" && <DangerZoneSettings />}
		</SettingsFrame>
	);
}

/**
 * The phone's landing: each section with its line, in one pool. The strip's
 * Settings door (Sidebar.tsx) returns a section here.
 */
function SectionList() {
	const sections = useSettingsSections();
	return (
		<div
			className="fixed inset-x-0 bottom-0 top-(--frame-top) flex flex-col bg-canvas"
			data-testid="settings-frame"
		>
			<PageHeader title="Settings" />
			<nav
				className="min-h-0 flex-1 overflow-y-auto px-4 pt-2 pb-12"
				aria-label="Settings sections"
				data-testid="settings-section-list"
			>
				<Pool>
					{sections.map((s) => (
						<Row
							key={s.tab}
							className="relative"
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
							meta={s.line || "\u00a0"}
							trailing={<ChevronRight className="size-4 text-text-3" />}
						/>
					))}
				</Pool>
			</nav>
		</div>
	);
}
