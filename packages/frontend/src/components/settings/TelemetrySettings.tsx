// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MutationError } from "@/components/shared/MutationError";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { orpc } from "@/lib/api/orpc-client";

/**
 * The one-sentence version, on the consent line where the owner first meets the
 * question. Settings carries the full disclosure below it (#602).
 */
export const TELEMETRY_SUMMARY =
	"Usage data: which features get used and whether investigations finish — counts and categories only, never the content of an alert, a repository or a report.";

/** Everything sent, in the order it is worth reading. */
export const TELEMETRY_SENT = [
	"An install id: a random identifier created once for this workspace.",
	"The PrismaLens version, whether it is a release or a development build, how it was installed (npm, the installer, Homebrew, Scoop or the desktop app), the operating system, CPU architecture and Node major version.",
	"One event per milestone, carrying fixed categories only: setup finished; a service gained a repository (local folder or git); an integration was configured (which vendor); the first alert this install ever received (which source); an investigation started (which coding agent, and whether it was asked for by hand or by an alert); an investigation ended (its outcome, how long it took as one of four ranges, and a category for the failure); a report was viewed; a report was exported (Markdown, Slack or a GitHub comment); an incident was closed.",
	"Once a day while PrismaLens is running and sharing is on: a sign that this install is active, with nothing else attached.",
];

/** What cannot be sent, because no property in the taxonomy could carry it. */
export const TELEMETRY_NEVER_SENT =
	"Never sent: alert text or payloads, repository names or URLs, prompts, anything a model wrote, API keys, hostnames, workspace paths, email addresses, names, or error messages. Each event is recorded with its date only, never the time of day. Every property is a fixed category, a range or a yes/no — there is no free-text field anywhere in what is sent.";

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
				className="space-y-1.5 border-t px-3 py-2 text-meta text-muted-foreground"
				data-testid="telemetry-consent"
			>
				<p>Share usage counts? Never an alert, a repo or a report.</p>
				<div className="flex items-center gap-1">
					<Button
						variant="outline"
						size="sm"
						className="h-6 flex-1 px-2 text-meta"
						disabled={update.isPending}
						onClick={() => update.mutate({ enabled: false })}
					>
						No thanks
					</Button>
					<Button
						size="sm"
						className="h-6 flex-1 px-2 text-meta"
						disabled={update.isPending}
						onClick={() => update.mutate({ enabled: true })}
					>
						Share
					</Button>
				</div>
				{update.isError && (
					<p className="text-destructive">Could not save — try again.</p>
				)}
			</div>
		);
	}

	return (
		<div
			className="flex flex-col gap-3 rounded-md border border-border bg-muted/40 px-4 py-3 text-record sm:flex-row sm:items-center sm:justify-between"
			data-testid="telemetry-consent"
		>
			<p className="text-muted-foreground">
				Help improve PrismaLens? {TELEMETRY_SUMMARY} Nothing is sent unless you
				say yes, and Settings → Usage data changes the answer at any time.
			</p>
			<div className="flex shrink-0 items-center gap-2">
				{update.isError && (
					<span className="text-destructive">Could not save — try again.</span>
				)}
				<Button
					variant="outline"
					size="sm"
					disabled={update.isPending}
					onClick={() => update.mutate({ enabled: false })}
				>
					No thanks
				</Button>
				<Button
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

export function TelemetrySettings() {
	const { query, update } = useTelemetrySettings();
	const settings = query.data;

	return (
		<div className="rounded-md border bg-card p-4 space-y-4 text-record">
			<h3 className="text-sm font-semibold tracking-tight text-foreground">
				Usage data
			</h3>
			<p className="text-muted-foreground">{TELEMETRY_SUMMARY}</p>
			<div className="space-y-2 text-muted-foreground">
				<p className="font-medium text-foreground">What is sent</p>
				<ul className="list-disc space-y-1 pl-5">
					{TELEMETRY_SENT.map((item) => (
						<li key={item}>{item}</li>
					))}
				</ul>
			</div>
			<p className="text-muted-foreground">{TELEMETRY_NEVER_SENT}</p>
			<div className="space-y-2 text-muted-foreground">
				<p className="font-medium text-foreground">
					The install id, and your consent
				</p>
				<p>
					The install id is random, but it is the same on every event this
					install sends — which is what makes it possible to count installs
					rather than events. That makes it pseudonymous rather than anonymous,
					so it is treated as personal data, and your consent — the checkbox
					below — is the only basis on which any of it is collected. It is not
					joined to an account or a profile, and the IP address a request
					arrives from is discarded rather than stored or resolved to a
					location.
				</p>
				<p>
					Events are kept for as long as PostHog's plan retains them — at least
					one year on the plan we use — and are not joined to anything else.
					Clearing the checkbox withdraws consent and stops collection from that
					moment. A factory reset deletes the id with everything else, so a
					reset install starts over as a new, unrelated one.
				</p>
			</div>
			<div className="flex items-center gap-2">
				<Checkbox
					id="telemetry-enabled"
					checked={settings?.enabled ?? false}
					disabled={!settings || settings.forcedOff || update.isPending}
					onCheckedChange={(checked) =>
						update.mutate({ enabled: checked === true })
					}
				/>
				<Label htmlFor="telemetry-enabled">Share usage data</Label>
			</div>
			<details className="space-y-2">
				<summary className="cursor-pointer font-medium text-foreground">
					Recently sent ({settings?.recentlySent.length ?? 0})
				</summary>
				<p className="text-muted-foreground">
					The last 20 events exactly as sent, less the PostHog project key, kept
					in memory until PrismaLens restarts.
				</p>
				{!settings?.recentlySent.length ? (
					<p className="text-muted-foreground">
						Nothing sent since PrismaLens started.
					</p>
				) : (
					<div className="space-y-2">
						{settings.recentlySent.map((entry, index) => (
							<pre
								key={index}
								className="max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded-md border bg-muted/40 p-3 font-mono text-meta text-muted-foreground"
							>
								{JSON.stringify(entry.payload, null, 2)}
							</pre>
						))}
					</div>
				)}
			</details>
			{settings?.forcedOff && (
				<p className="text-muted-foreground">
					Off for this process: <code>PRISMALENS_TELEMETRY=off</code> or{" "}
					<code>pl up --telemetry=off</code> is set.
				</p>
			)}
			<MutationError error={update.error} />
		</div>
	);
}
