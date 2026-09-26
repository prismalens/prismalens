// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { About } from "@prismalens/contracts";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";
import { StateWord } from "@/components/shared/StateChip";
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
			<code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-md border bg-muted px-3 py-2 font-mono text-xs text-foreground">
				{command}
			</code>
			<Button
				variant="outline"
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

function Row({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div className="grid grid-cols-[9rem_1fr] gap-3 py-2 sm:grid-cols-[11rem_1fr]">
			<dt className="text-muted-foreground">{label}</dt>
			<dd className="min-w-0 break-words text-foreground">{children}</dd>
		</div>
	);
}

export function AboutSettings() {
	const { data: about, isError } = useAbout();

	if (isError) {
		return (
			<div className="rounded-md border bg-card p-4 text-record text-destructive">
				Couldn't read this install's details. Reload to try again.
			</div>
		);
	}
	if (!about) {
		return <div className="h-48 animate-pulse rounded-lg border bg-card" />;
	}

	const { update } = about;
	return (
		<div className="space-y-4 text-record">
			<div className="rounded-md border bg-card p-4 space-y-4">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<h3 className="text-sm font-semibold tracking-tight text-foreground">
						Updates
					</h3>
					{update.disabledBy ? (
						<StateWord tone="neutral">check off</StateWord>
					) : update.available ? (
						<StateWord tone="primary">update available</StateWord>
					) : (
						<StateWord tone="done">up to date</StateWord>
					)}
				</div>
				{update.disabledBy ? (
					<p className="text-muted-foreground">
						The update check is off because <code>{update.disabledBy}</code> is
						set. Unset it to hear about new releases.
					</p>
				) : update.available && update.latest ? (
					<>
						<p className="text-foreground">
							PrismaLens {update.latest} is available. You have {about.version}.
							{update.releaseNotesUrl && (
								<a
									className="ml-2 inline-flex items-center gap-1 text-primary hover:underline"
									href={update.releaseNotesUrl}
									target="_blank"
									rel="noreferrer"
								>
									Release notes <ExternalLink className="h-3 w-3" />
								</a>
							)}
						</p>
						{about.channel !== "electron" && (
							<p className="text-muted-foreground">
								Stop <code>pl up</code>, then run this. It upgrades with{" "}
								{CHANNEL_LABEL[about.channel]}, the way this copy was installed.
							</p>
						)}
						{about.channel === "electron" ? (
							<p className="text-foreground">
								Download the new desktop app from the release notes above.
							</p>
						) : (
							<CommandLine command="pl upgrade" />
						)}
					</>
				) : (
					<p className="text-muted-foreground">
						You're on the newest release.
						{update.checkedAt &&
							` Checked ${formatDateTime(update.checkedAt)}.`}
					</p>
				)}
				{!update.disabledBy && (
					<p className="text-xs text-muted-foreground">
						PrismaLens asks GitHub once a day which release is newest. The
						request carries nothing about you or this install.
					</p>
				)}
			</div>

			<div className="rounded-md border bg-card p-4">
				<h3 className="text-sm font-semibold tracking-tight text-foreground">
					This install
				</h3>
				<dl className="mt-2 divide-y">
					<Row label="Version">
						{about.version}
						{about.build === "dev" && (
							<span className="ml-2 text-muted-foreground">
								(development build)
							</span>
						)}
					</Row>
					<Row label="Installed with">{CHANNEL_LABEL[about.channel]}</Row>
					<Row label="Workspace">
						<code className="font-mono text-xs">{about.workspaceDir}</code>
					</Row>
					<Row label="Last database backup">
						{about.latestBackup ? (
							<>
								<code className="font-mono text-xs">{about.latestBackup}</code>
								<p className="mt-1 text-xs text-muted-foreground">
									Made before the last migration. Restore it in place of{" "}
									<code>prismalens.db</code> to go back a version.
								</p>
							</>
						) : (
							<span className="text-muted-foreground">
								None yet; one is made before each migration
							</span>
						)}
					</Row>
				</dl>
			</div>
		</div>
	);
}
