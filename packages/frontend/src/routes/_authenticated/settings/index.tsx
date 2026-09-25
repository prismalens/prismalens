import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useEffect } from "react";
import {
	AboutSettings,
	DangerZoneSettings,
	HarnessSettings,
	IntegrationsSettings,
	TelemetrySettings,
} from "@/components/settings";
import { ConnectionsTab } from "@/components/settings/ConnectionsTab";
import { DevicesTab } from "@/components/settings/DevicesTab";
import { SettingsFrame } from "@/components/settings/SettingsFrame";
import { orpc } from "@/lib/api/orpc-client";

export const Route = createFileRoute("/_authenticated/settings/")({
	component: SettingsPage,
});

const SECTIONS = {
	harness: {
		title: "Agent",
		intro:
			"The coding agent a run rents to read the repo and the telemetry. It signs in on its own; a key is not always needed.",
	},
	integrations: {
		title: "Integrations",
		intro:
			"Where alerts come from, where the report goes, and which git host holds the code.",
	},
	connections: {
		title: "Connections",
		intro:
			"The accounts and tokens behind each integration. One integration can have several.",
	},
	devices: {
		title: "Devices",
		intro:
			"Phones and computers paired with this instance. Pair one with a one-time link; revoke it here.",
	},
	usage: {
		title: "Usage data",
		intro:
			"Counts of what gets used and whether runs finish. Off until you say yes.",
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
	const { tab = "harness" } = useSearch({ from: "/_authenticated/settings" });
	const queryClient = useQueryClient();

	// Actions on other screens change what these sections show; refetch on entry.
	useEffect(() => {
		queryClient.invalidateQueries({ queryKey: orpc.integrations.key() });
		queryClient.invalidateQueries({ queryKey: orpc.settings.key() });
	}, [queryClient]);

	const section = SECTIONS[tab];
	return (
		<SettingsFrame section={tab} title={section.title} intro={section.intro}>
			{tab === "harness" && <HarnessSettings />}
			{tab === "integrations" && <IntegrationsSettings />}
			{tab === "connections" && <ConnectionsTab />}
			{tab === "devices" && <DevicesTab />}
			{tab === "usage" && <TelemetrySettings />}
			{tab === "about" && <AboutSettings />}
			{tab === "danger" && <DangerZoneSettings />}
		</SettingsFrame>
	);
}
