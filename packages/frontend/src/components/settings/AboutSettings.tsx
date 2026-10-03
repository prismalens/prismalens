// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { About } from "@prismalens/contracts";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";
import { SettingGroup, SettingRow } from "@/components/shared/SettingRow";
import { Button } from "@/components/ui/button";
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

/** A command with a copy button; the text stays selectable when the clipboard is refused. */
export function CommandLine({ command }: { command: string }) {
	const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
	return (
		<div className="flex items-center gap-2">
			<code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-control bg-surface-2 px-3 py-1.5 font-mono text-meta text-text-1">
				{command}
			</code>
			<Button
				variant="ghost"
				size="icon"
				aria-label={copied === "copied" ? "Copied" : "Copy command"}
				onClick={() => {
					navigator.clipboard
						.writeText(command)
						.then(() => setCopied("copied"))
						.catch(() => setCopied("failed"));
				}}
			>
				{copied === "copied" ? (
					<Check className="h-4 w-4" />
				) : (
					<Copy className="h-4 w-4" />
				)}
			</Button>
		</div>
	);
}

export function AboutSettings() {
	const { data: about, isError } = useAbout();

	if (isError) {
		return (
			<p className="text-body text-danger">
				Couldn't read this install's details. Reload to try again.
			</p>
		);
	}
	if (!about) return null;

	const { update } = about;
	return (
		<>
			<SettingGroup title="Updates" testId="about-updates">
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
								<code>{update.disabledBy}</code> is set. Unset it to hear about
								new releases.
							</>
						) : update.available ? (
							<>
								You have {about.version}.{" "}
								{about.channel === "electron"
									? "Download the new desktop app from the release notes."
									: `Stop pl up, then run this. It upgrades with ${CHANNEL_LABEL[about.channel]}, the way this copy was installed.`}
							</>
						) : (
							<>
								PrismaLens asks GitHub once a day which release is newest; the
								request carries nothing about you or this install.
								{update.checkedAt &&
									` Checked ${formatDateTime(update.checkedAt)}.`}
							</>
						)
					}
					below={
						update.available &&
						about.channel !== "electron" && <CommandLine command="pl upgrade" />
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
			</SettingGroup>
			<SettingGroup title="This install" testId="about-install">
				<SettingRow
					label="Version"
					description={about.build ? `Build ${about.build}` : undefined}
				>
					<span className="text-body text-text-1">{about.version}</span>
				</SettingRow>
				<SettingRow label="Installed with">
					<span className="text-body text-text-1">
						{CHANNEL_LABEL[about.channel]}
					</span>
				</SettingRow>
				<SettingRow
					label="Workspace"
					description={<code className="break-all">{about.workspaceDir}</code>}
				/>
				<SettingRow
					label="Last database backup"
					description={
						about.latestBackup ? (
							<>
								<code className="break-all">{about.latestBackup}</code>. Made
								before the last migration; restore it in place of{" "}
								<code>prismalens.db</code> to go back a version.
							</>
						) : (
							"None yet; one is made before each migration."
						)
					}
				/>
			</SettingGroup>
		</>
	);
}
