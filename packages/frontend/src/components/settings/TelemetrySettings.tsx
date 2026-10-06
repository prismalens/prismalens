// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { Mono } from "@/components/shared/Mono";
import { MutationError } from "@/components/shared/MutationError";
import { Pool, Row } from "@/components/shared/Row";
import { SettingGroup, SettingRow } from "@/components/shared/SettingRow";
import { Empty } from "@/components/shared/State";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { orpc } from "@/lib/api/orpc-client";

/**
 * The one-sentence version, on the consent line where the owner first meets the
 * question. Settings carries the full disclosure below it (#602).
 */
export const TELEMETRY_SUMMARY =
	"Usage data: which features get used and whether investigations finish: counts and categories only, never the content of an alert, a repository or a report.";

/** Everything sent, in the order it is worth reading. */
export const TELEMETRY_SENT = [
	"An install id: a random identifier created once for this workspace.",
	"The PrismaLens version, whether it is a release or a development build, how it was installed (npm, the installer, Homebrew, Scoop or the desktop app), the operating system, CPU architecture and Node major version.",
	"One event per milestone, carrying fixed categories only: setup finished; a service gained a repository (local folder or git); an integration was configured (which vendor); the first alert this install ever received (which source); an investigation started (which coding agent, and whether it was asked for by hand or by an alert); an investigation ended (its outcome, how long it took as one of four ranges, and a category for the failure); a report was viewed; a report was exported (Markdown, Slack or a GitHub comment); an incident was closed.",
	"Once a day while PrismaLens is running and sharing is on: a sign that this install is active, with nothing else attached.",
];

/** What cannot be sent, because no property in the taxonomy could carry it. */
export const TELEMETRY_NEVER_SENT =
	"Never sent: alert text or payloads, repository names or URLs, prompts, anything a model wrote, API keys, hostnames, workspace paths, email addresses, names, or error messages. Each event is recorded with its date only, never the time of day. Every property is a fixed category, a range or a yes/no; there is no free-text field anywhere in what is sent.";

export function useTelemetrySettings() {
	const queryClient = useQueryClient();
	const query = useQuery(orpc.settings.telemetry.get.queryOptions());
	const update = useMutation({
		...orpc.settings.telemetry.update.mutationOptions(),
		onSuccess: (data) =>
			queryClient.setQueryData(orpc.settings.telemetry.get.queryKey(), data),
	});
	return { query, update };
}

/** The one-time question on /incidents, until the owner answers (#602). */
export function TelemetryConsent({
	variant = "card",
}: {
	variant?: "card" | "strip";
}) {
	const { query, update } = useTelemetrySettings();
	if (!query.data || query.data.decided || query.data.forcedOff) return null;

	if (variant === "strip") {
		return (
			<div
				className="mx-2 mb-2 space-y-1.5 rounded-surface bg-surface-2 px-3 py-2 text-meta text-text-2"
				data-testid="telemetry-consent"
			>
				<p>Share usage counts? Never an alert, a repo or a report.</p>
				<div className="flex items-center gap-1">
					<Button
						variant="text"
						size="sm"
						className="flex-1"
						disabled={update.isPending}
						onClick={() => update.mutate({ enabled: false })}
					>
						No thanks
					</Button>
					<Button
						size="sm"
						variant="secondary"
						className="flex-1"
						disabled={update.isPending}
						onClick={() => update.mutate({ enabled: true })}
					>
						Share
					</Button>
				</div>
				{update.isError && <p className="text-danger">Not saved. Try again.</p>}
			</div>
		);
	}

	return (
		<div
			className="raised flex flex-col gap-3 rounded-surface px-4 py-3 text-body sm:flex-row sm:items-center sm:justify-between"
			data-testid="telemetry-consent"
		>
			<p className="text-text-2">
				Help improve PrismaLens? {TELEMETRY_SUMMARY} Nothing is sent unless you
				say yes, and Settings → Usage data changes the answer at any time.
			</p>
			<div className="flex shrink-0 items-center gap-2">
				{update.isError && (
					<span className="text-danger">Not saved. Try again.</span>
				)}
				<Button
					variant="text"
					size="sm"
					disabled={update.isPending}
					onClick={() => update.mutate({ enabled: false })}
				>
					No thanks
				</Button>
				<Button
					variant="primary"
					size="sm"
					disabled={update.isPending}
					onClick={() => update.mutate({ enabled: true })}
				>
					Share usage data
				</Button>
			</div>
		</div>
	);
}

/**
 * Settings, Usage data (decision 8, study-v3 §7): one switch whose line says
 * what is sent, the full disclosure folded in the row under it, and what was
 * recently sent. An env lock reads as words, never as an ordinary off switch.
 */
export function TelemetrySettings() {
	const { query, update } = useTelemetrySettings();
	const settings = query.data;
	const sent = settings?.recentlySent ?? [];
	return (
		<>
			<Pool>
				<SettingRow
					label={<label htmlFor="telemetry-enabled">Share usage counts</label>}
					description={
						settings?.forcedOff ? (
							<>
								Off for this process: <Mono>PRISMALENS_TELEMETRY=off</Mono> or{" "}
								<Mono>pl up --telemetry=off</Mono> is set
							</>
						) : (
							"Feature use and run outcomes under a random install id; never an alert, code or a report"
						)
					}
					testId="telemetry-row"
				>
					{settings?.forcedOff ? (
						<span className="text-meta text-text-3">Locked off</span>
					) : (
						<Switch
							id="telemetry-enabled"
							checked={settings?.enabled ?? false}
							disabled={!settings || update.isPending}
							onCheckedChange={(checked) => update.mutate({ enabled: checked })}
							data-testid="telemetry-switch"
						/>
					)}
				</SettingRow>
				<Row
					testId="telemetry-disclosure-row"
					label={
						<details className="group" data-testid="telemetry-disclosure">
							<summary className="flex cursor-pointer list-none items-center gap-1.5 text-accent [&::-webkit-details-marker]:hidden">
								<ChevronRight className="size-3.5 transition-transform duration-(--dur-fast) group-open:rotate-90" />
								What is sent, what never is, and how consent works
							</summary>
							<div className="mt-3 mb-1 space-y-3 text-text-2">
								<div>
									<p className="font-medium text-text-1">What is sent</p>
									<ul className="mt-1 space-y-1">
										{TELEMETRY_SENT.map((item) => (
											<li key={item}>{item}</li>
										))}
									</ul>
								</div>
								<div>
									<p className="font-medium text-text-1">What is never sent</p>
									<p className="mt-1">{TELEMETRY_NEVER_SENT}</p>
								</div>
								<div>
									<p className="font-medium text-text-1">
										The install id, and your consent
									</p>
									<p className="mt-1">
										The install id is random, but it is the same on every event
										this install sends, which is what makes it possible to count
										installs rather than events. That makes it pseudonymous
										rather than anonymous, so it is treated as personal data,
										and your consent, the switch above, is the only basis on
										which any of it is collected. It is not joined to an account
										or a profile, and the IP address a request arrives from is
										discarded rather than stored or resolved to a location.
									</p>
								</div>
								<div>
									<p className="font-medium text-text-1">How long it is kept</p>
									<p className="mt-1">
										Events are kept for as long as PostHog's plan retains them,
										at least one year on the plan we use, and are not joined to
										anything else. Turning the switch off withdraws consent and
										stops collection from that moment. A factory reset deletes
										the id with everything else, so a reset install starts over
										as a new, unrelated one.
									</p>
								</div>
							</div>
						</details>
					}
				/>
			</Pool>
			<MutationError error={update.error} className="mt-2" />
			<SettingGroup
				title="Recently sent"
				count={sent.length || undefined}
				testId="telemetry-recent"
				className="mt-8"
				description="The last 20 events exactly as sent, less the PostHog project key, kept in memory until PrismaLens restarts."
			>
				{sent.length === 0 ? (
					<Empty text="Nothing sent since PrismaLens started." />
				) : (
					<Pool>
						{sent.map((entry, index) => (
							<Row
								// biome-ignore lint/suspicious/noArrayIndexKey: a fixed, newest-first list
								key={`${index}-${String(entry.payload.event ?? "")}`}
								testId="telemetry-sent"
								label={
									<details className="group">
										<summary className="flex cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden">
											<ChevronRight className="size-3.5 text-text-3 transition-transform duration-(--dur-fast) group-open:rotate-90" />
											<Mono>{String(entry.payload.event ?? "event")}</Mono>
										</summary>
										<pre className="mt-2 mb-1 max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded-control bg-well-in-pool p-3 font-mono text-meta text-text-2">
											{JSON.stringify(entry.payload, null, 2)}
										</pre>
									</details>
								}
							/>
						))}
					</Pool>
				)}
			</SettingGroup>
		</>
	);
}
