// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { About } from "@prismalens/contracts";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { CopyButton } from "@/components/shared/CopyButton";
import { Mono } from "@/components/shared/Mono";
import { Pool } from "@/components/shared/Row";
import { SettingGroup, SettingRow } from "@/components/shared/SettingRow";
import { Loading, Problem } from "@/components/shared/State";
import { orpc } from "@/lib/api/orpc-client";
import { formatDateTime } from "@/lib/format-time";

export const CHANNEL_LABEL: Record<About["channel"], string> = {
	npm: "npm",
	installer: "the installer",
	homebrew: "Homebrew",
	scoop: "Scoop",
	electron: "the desktop app",
};

/** Settings → About and the nav dot share one query (#717). */
export function useAbout(enabled = true) {
	return useQuery({
		...orpc.settings.about.get.queryOptions(),
		enabled,
		staleTime: 60 * 60 * 1000,
	});
}

/** A command to run, in mono, with the one Copy button (look ruling §2). */
export function CommandLine({ command }: { command: string }) {
	return (
		<div className="flex min-w-0 items-center gap-2">
			<code className="min-w-0 flex-1 truncate rounded-control bg-well-in-pool px-2.5 py-1 font-mono text-meta text-text-1">
				{command}
			</code>
			<CopyButton value={command} />
		</div>
	);
}

export function AboutSettings() {
	const { data: about, isError, refetch } = useAbout();

	if (isError) {
		return (
			<Problem
				text="This install's details did not load."
				onRetry={() => refetch()}
			/>
		);
	}
	if (!about) return <Loading rows={4} />;

	const { update } = about;
	return (
		<>
			<SettingGroup title="Updates" testId="about-updates">
				<Pool>
					<SettingRow
						label={
							update.disabledBy
								? "The update check is off"
								: update.available && update.latest
									? `PrismaLens ${update.latest} is available`
									: "You're on the newest release"
						}
						description={
							update.disabledBy ? (
								<>
									<Mono>{update.disabledBy}</Mono> is set; unset it to hear
									about new releases
								</>
							) : update.available ? (
								about.channel === "electron" ? (
									`You have ${about.version}. Download the new desktop app from the release notes`
								) : (
									`You have ${about.version}. Stop pl up, then run this; it upgrades with ${CHANNEL_LABEL[about.channel]}`
								)
							) : update.checkedAt ? (
								`Checked ${formatDateTime(update.checkedAt)}; the request carries nothing about this install`
							) : (
								"PrismaLens asks GitHub once a day; the request carries nothing about this install"
							)
						}
						below={
							update.available &&
							about.channel !== "electron" && (
								<CommandLine command="pl upgrade" />
							)
						}
					>
						{update.available && update.releaseNotesUrl && (
							<a
								className="inline-flex items-center gap-1 text-body text-accent hover:underline"
								href={update.releaseNotesUrl}
								target="_blank"
								rel="noreferrer"
							>
								Release notes <ExternalLink className="size-3" />
							</a>
						)}
					</SettingRow>
				</Pool>
			</SettingGroup>
			<SettingGroup
				title="This install"
				testId="about-install"
				description={
					<>
						A database backup is made before each migration; restore it in place
						of <Mono>prismalens.db</Mono> to go back a version.
					</>
				}
			>
				<Pool>
					<SettingRow
						label="Version"
						description={
							<Mono>
								{about.version}
								{about.build ? `, build ${about.build}` : ""}
							</Mono>
						}
					/>
					<SettingRow
						label="Installed with"
						description={CHANNEL_LABEL[about.channel]}
					/>
					<SettingRow
						label="Workspace"
						description={<Mono>{about.workspaceDir}</Mono>}
					>
						<CopyButton value={about.workspaceDir} variant="text" />
					</SettingRow>
					<SettingRow
						label="Last database backup"
						description={
							about.latestBackup ? (
								<Mono>{about.latestBackup}</Mono>
							) : (
								"None yet"
							)
						}
					>
						{about.latestBackup && (
							<CopyButton value={about.latestBackup} variant="text" />
						)}
					</SettingRow>
				</Pool>
			</SettingGroup>
		</>
	);
}
