// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type About,
	isWorkflowLive,
	type UpdateInstallStatus,
} from "@prismalens/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Streamdown } from "streamdown";
import { Ring } from "@/components/shared/Ring";
import { SettingRow } from "@/components/shared/SettingRow";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useOperator } from "@/hooks/use-operator";
import { useThreadFeed } from "@/lib/api/hooks/use-threads-orpc";
import { orpc } from "@/lib/api/orpc-client";
import { getErrorMessage } from "@/lib/get-error-message";
import { CommandLine } from "../AboutSettings";
import {
	blockedWords,
	canInstall,
	idleInstallBlocked,
	UPDATES_WORD,
	type UpdatesValue,
	updatesPrefs,
	updatesValue,
} from "./update-words";

const aboutKey = () => orpc.settings.about.get.queryKey();

/** About → Updates: Notify me, Install when idle, or Never check. Host only. */
export function UpdatesRow({ about }: { about: About }) {
	const queryClient = useQueryClient();
	const { managesPairing: host } = useOperator();
	const save = useMutation({
		...orpc.settings.update.prefs.mutationOptions(),
		onSuccess: (next) => queryClient.setQueryData(aboutKey(), next),
	});
	const idleBlocked = idleInstallBlocked(about);
	const value = updatesValue(about);
	return (
		<SettingRow
			label={<span id="about-updates-label">Updates</span>}
			description={
				!host
					? "Only the computer running PrismaLens can change this."
					: about.update.disabledBy
						? `${about.update.disabledBy} turns the check off`
						: idleBlocked
							? `Install when idle: ${blockedWords(idleBlocked)}`
							: "Installs never interrupt a run"
			}
			testId="about-updates-row"
		>
			<Select
				value={value}
				onValueChange={(v) => save.mutate(updatesPrefs(v as UpdatesValue))}
				disabled={!host || save.isPending || !!about.update.disabledBy}
			>
				<SelectTrigger
					aria-labelledby="about-updates-label"
					className="w-44"
					data-testid="about-updates-select"
				>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{(Object.keys(UPDATES_WORD) as UpdatesValue[]).map((k) => (
						<SelectItem
							key={k}
							value={k}
							disabled={k === "idle" && !!idleBlocked && value !== "idle"}
						>
							{UPDATES_WORD[k]}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</SettingRow>
	);
}

/** Live runs in the thread feed the sidebar already holds; undefined until it loads. */
function useLiveRunCount(enabled: boolean): number | undefined {
	const feed = useThreadFeed({}, enabled);
	if (!enabled || !feed.data) return undefined;
	return feed.data.pages
		.flatMap((p) => p.units)
		.flatMap((u) => u.threads)
		.filter((t) => isWorkflowLive(t.status)).length;
}

const WORKING = new Set<UpdateInstallStatus["phase"]>([
	"downloading",
	"verifying",
	"installing",
	"restarting",
]);

export const PHASE_WORD: Record<UpdateInstallStatus["phase"], string> = {
	idle: "",
	downloading: "Downloading",
	verifying: "Verifying",
	installing: "Installing",
	restarting: "Restarting",
	failed: "Install failed",
	done: "Restarting",
};

/**
 * An available update: Install and restart on an installer copy (idle only),
 * else the upgrade command; the notes below. It never interrupts work.
 */
export function UpdateAvailable({
	about,
	liveRuns: given,
}: {
	about: About;
	/** Live runs, for the busy words; read from the sidebar's own feed when absent. */
	liveRuns?: number;
}) {
	const counted = useLiveRunCount(about.update.install?.blockedBy === "busy");
	const liveRuns = given ?? counted;
	const queryClient = useQueryClient();
	const [started, setStarted] = useState(false);
	const latest = about.update.latest;
	const install = useMutation({
		...orpc.settings.update.install.mutationOptions(),
		onSuccess: () => setStarted(true),
	});
	const status = useQuery({
		...orpc.settings.update.status.queryOptions(),
		enabled: started,
		// The server goes away while it restarts; keep asking until it answers on the new version.
		refetchInterval: started ? 1500 : false,
		retry: true,
	});
	useEffect(() => {
		if (started && status.data && latest && status.data.version === latest)
			if (status.data.phase === "idle" || status.data.phase === "done")
				window.location.reload();
	}, [started, status.data, latest]);
	const phase = started ? (status.data?.phase ?? "restarting") : "idle";
	const working = WORKING.has(phase) || phase === "done";
	const blocker = about.update.install?.blockedBy;
	const installer = about.update.install && blocker !== "not_installer";
	const channel = about.updateChannel;

	return (
		<div className="grid gap-3" data-testid="about-update-available">
			{installer ? (
				<div className="flex flex-wrap items-center gap-3">
					<Button
						disabled={
							!canInstall(about) || working || install.isPending || !latest
						}
						onClick={() => latest && install.mutate({ version: latest })}
						data-testid="about-install"
					>
						{working && <Ring className="size-4" />}
						{working ? PHASE_WORD[phase] : "Install and restart"}
					</Button>
					{!working && blocker && (
						<span
							className="text-meta text-text-3"
							data-testid="about-install-blocked"
						>
							{blockedWords(blocker, liveRuns)}
						</span>
					)}
					{!working &&
						!blocker &&
						channel?.current === "nightly" &&
						channel.nightlyBlockedBy && (
							<span
								className="text-meta text-text-3"
								data-testid="about-install-blocked"
							>
								Nightly installs through npm only
							</span>
						)}
					{status.data?.draining && (
						<span
							className="text-meta text-text-3"
							data-testid="about-install-draining"
						>
							New work waits for the restart
						</span>
					)}
				</div>
			) : (
				<CommandLine command={about.upgradeCommand} />
			)}
			{(install.error || status.data?.error) && (
				<p
					className="text-meta text-danger"
					role="alert"
					data-testid="about-install-error"
				>
					{status.data?.error ?? getErrorMessage(install.error)}
				</p>
			)}
			{about.update.notes && (
				<div
					className="max-h-72 overflow-y-auto rounded-surface bg-surface-1 px-3 py-2 text-body text-text-2"
					data-testid="about-release-notes"
				>
					<Streamdown
						components={{
							a: ({ node: _node, ...props }) => (
								<a
									{...props}
									target="_blank"
									rel="noreferrer"
									className="text-accent hover:underline"
								/>
							),
						}}
					>
						{about.update.notes}
					</Streamdown>
				</div>
			)}
			<CheckNowButton />
		</div>
	);
}

/** Check now: `POST /settings/update/check`, its answer replacing About's. */
export function CheckNowButton() {
	const queryClient = useQueryClient();
	const check = useMutation({
		...orpc.settings.update.check.mutationOptions(),
		onSuccess: (next) => queryClient.setQueryData(aboutKey(), next),
	});
	return (
		<div className="mt-3">
			<Button
				variant="secondary"
				size="sm"
				disabled={check.isPending}
				onClick={() => check.mutate({})}
				data-testid="about-check-now"
			>
				{check.isPending ? "Checking" : "Check now"}
			</Button>
		</div>
	);
}

/** About → Help: copy the doctor's checks, on the host only. */
export function CopyDiagnosticsRow() {
	const { managesPairing: host } = useOperator();
	const [copied, setCopied] = useState(false);
	const diag = useQuery({
		...orpc.settings.about.diagnostics.queryOptions(),
		enabled: false,
	});
	const copy = async () => {
		const { data } = await diag.refetch();
		if (!data) return;
		const text = data.checks
			.map(
				(c) =>
					`${c.status.padEnd(4)} ${c.label}: ${c.detail}${c.fix ? ` (${c.fix})` : ""}`,
			)
			.join("\n");
		await navigator.clipboard.writeText(
			`PrismaLens diagnostics, ${data.ranAt}\n${text}`,
		);
		setCopied(true);
	};
	return (
		<SettingRow
			label="Diagnostics"
			description={
				host ? "What pl doctor checks, redacted" : "Copy on the host machine"
			}
			testId="about-diagnostics-row"
		>
			<Button
				variant="secondary"
				size="sm"
				disabled={!host || diag.isFetching}
				onClick={() => void copy()}
				data-testid="about-copy-diagnostics"
			>
				{diag.isFetching ? "Copying" : copied ? "Copied" : "Copy diagnostics"}
			</Button>
		</SettingRow>
	);
}
