// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { About, UpdateChannel } from "@prismalens/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { useEffect } from "react";
import { CopyButton } from "@/components/shared/CopyButton";
import { Mono } from "@/components/shared/Mono";
import { Pool } from "@/components/shared/Row";
import { SettingGroup, SettingRow } from "@/components/shared/SettingRow";
import { Loading, Problem } from "@/components/shared/State";
import { Badge } from "@/components/ui/badge";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { orpc } from "@/lib/api/orpc-client";
import { formatDateTime } from "@/lib/format-time";
import {
	CheckNowButton,
	CopyDiagnosticsRow,
	UpdateAvailable,
	UpdatesRow,
} from "./about/UpdatesPanel";
import { DangerZoneSettings } from "./DangerZoneSettings";
import { useAbout } from "./use-about";

export const CHANNEL_LABEL: Record<About["channel"], string> = {
	npm: "npm",
	installer: "the installer",
	homebrew: "Homebrew",
	scoop: "Scoop",
	electron: "the desktop app",
};

/** Settings → About and the nav dot share one query (#717). */
export { useAbout };

/** Stable or nightly (#1024). Nightly ships on npm only, and an env override can't be changed here. */
function ReleaseChannelRow({ about }: { about: About }) {
	const queryClient = useQueryClient();
	const save = useMutation({
		...orpc.settings.update.prefs.mutationOptions(),
		onSuccess: (data) =>
			queryClient.setQueryData(orpc.settings.about.get.queryKey(), data),
	});
	const channel = about.updateChannel;
	if (!channel) return null;
	const description = save.error
		? save.error.message
		: channel.fromEnv
			? "PRISMALENS_UPDATE_CHANNEL sets it; unset it to choose here"
			: channel.nightlyBlockedBy
				? `Nightly builds ship on npm only; this copy was installed with ${CHANNEL_LABEL[about.channel]}`
				: channel.current === "nightly"
					? "A build of main each night its checks pass. pl upgrade follows it too"
					: "Tested releases. Nightly gets a build of main each night its checks pass";
	return (
		<SettingRow
			label="Release channel"
			description={description}
			below={
				channel.leavingNightly && (
					<p className="text-meta text-text-2">{channel.leavingNightly}</p>
				)
			}
		>
			<Select
				value={channel.current}
				disabled={channel.fromEnv || save.isPending}
				onValueChange={(value) =>
					save.mutate({ channel: value as UpdateChannel })
				}
			>
				<SelectTrigger
					aria-label="Release channel"
					data-testid="about-release-channel"
				>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="stable">Stable</SelectItem>
					<SelectItem
						value="nightly"
						disabled={channel.nightlyBlockedBy !== null}
					>
						Nightly
					</SelectItem>
				</SelectContent>
			</Select>
		</SettingRow>
	);
}

const HELP_LINKS = (notes: string | null) => [
	{ label: "Docs", href: "https://docs.prismalens.io" },
	{ label: "Issues", href: "https://github.com/prismalens/prismalens/issues" },
	{
		label: "Release notes",
		href: notes ?? "https://github.com/prismalens/prismalens/releases",
	},
];

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
	const { hash } = useLocation();
	// The old Danger zone tab lands here (#848); the section mounts after About loads.
	useEffect(() => {
		if (about && hash === "danger-zone")
			document
				.getElementById("danger-zone")
				?.scrollIntoView({ block: "start" });
	}, [about, hash]);

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
							<span className="inline-flex items-center gap-2">
								<Mono>
									{about.version}
									{about.build ? `, build ${about.build}` : ""}
								</Mono>
								{about.updateChannel?.nightlyBuild && (
									<Badge variant="secondary" data-testid="about-nightly-build">
										Nightly
									</Badge>
								)}
							</span>
						}
					/>
					{about.updateChannel && (
						<SettingRow
							label="Channel"
							description={
								about.updateChannel.current === "nightly" ? "Nightly" : "Stable"
							}
							testId="about-channel"
						/>
					)}
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
					{about.logsDir && (
						<SettingRow
							label="Logs"
							description={<Mono>{about.logsDir}</Mono>}
							testId="about-logs"
						>
							<CopyButton value={about.logsDir} variant="text" />
						</SettingRow>
					)}
					{about.runtime && (
						<SettingRow
							label="Runtime"
							description={`Node ${about.runtime.node}, ${about.runtime.os} ${about.runtime.arch}`}
							testId="about-runtime"
						/>
					)}
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
			<SettingGroup title="Updates" testId="about-updates">
				<Pool>
					<SettingRow
						label={
							update.disabledBy
								? "The update check is off"
								: update.available && update.latest
									? `PrismaLens ${update.latest} is available`
									: about.updateChannel?.leavingNightly
										? "Waiting for the next stable"
										: about.updateChannel
											? `Up to date on ${about.updateChannel.current}`
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
									`You have ${about.version}`
								)
							) : update.checkedAt ? (
								`Checked ${formatDateTime(update.checkedAt)}; the request carries nothing about this install`
							) : (
								"PrismaLens asks GitHub once a day; the request carries nothing about this install"
							)
						}
						below={
							update.available &&
							about.channel !== "electron" && <UpdateAvailable about={about} />
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
					<UpdatesRow about={about} />
					<ReleaseChannelRow about={about} />
				</Pool>
				{!update.available && !update.disabledBy && <CheckNowButton />}
			</SettingGroup>
			<SettingGroup title="Help" testId="about-help">
				<Pool>
					<CopyDiagnosticsRow />
					<SettingRow label="Links" testId="about-links">
						<span className="flex flex-wrap gap-3 text-body">
							{HELP_LINKS(update.releaseNotesUrl).map((l) => (
								<a
									key={l.label}
									className="inline-flex items-center gap-1 text-accent hover:underline"
									href={l.href}
									target="_blank"
									rel="noreferrer"
								>
									{l.label} <ExternalLink className="size-3" />
								</a>
							))}
						</span>
					</SettingRow>
				</Pool>
			</SettingGroup>
			<div id="danger-zone" className="mt-8 scroll-mt-4">
				<DangerZoneSettings />
			</div>
		</>
	);
}
