// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Install and restart from the app (#724) and the About update controls
 * (#1024 E): release notes, the auto-install guard, and the pieces of the
 * restart handoff that `pl up` and the API share.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { InstallChannel } from "./install-channel.js";

const RELEASES_API = "https://api.github.com/repos/prismalens/prismalens";
const NOTES_FILE = "release-notes.json";
const NOTES_TTL_MS = 24 * 60 * 60 * 1000;
const NOTES_MAX = 20_000;
const TIMEOUT_MS = 5_000;

export interface ReleaseNotes {
	version: string;
	/** Sanitised Markdown; the UI still renders it through its own sanitiser. */
	notes: string | null;
	publishedAt: string | null;
	fetchedAt: number;
}

/**
 * Raw HTML and script-capable link targets come out; the rest stays Markdown.
 * The release body is written by maintainers, but it is still remote text.
 */
export function sanitiseReleaseNotes(body: string): string {
	const cleaned = body
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/<\/?[a-zA-Z][^>]*>/g, "")
		.replace(/\]\(\s*(?:javascript|data|vbscript):[^)]*\)/gi, "]()")
		.trim();
	return cleaned.length > NOTES_MAX
		? `${cleaned.slice(0, NOTES_MAX)}\n\n…`
		: cleaned;
}

export function readReleaseNotes(workspaceDir: string): ReleaseNotes | null {
	try {
		const raw = JSON.parse(
			readFileSync(join(workspaceDir, NOTES_FILE), "utf8"),
		) as Partial<ReleaseNotes>;
		if (typeof raw.version !== "string" || typeof raw.fetchedAt !== "number")
			return null;
		return {
			version: raw.version,
			notes: typeof raw.notes === "string" ? raw.notes : null,
			publishedAt: typeof raw.publishedAt === "string" ? raw.publishedAt : null,
			fetchedAt: raw.fetchedAt,
		};
	} catch {
		return null;
	}
}

/**
 * The release body from the GitHub releases API (the host the update check
 * already asks), cached a day per version. Null when it can't be fetched;
 * the card then links the release page instead.
 */
export async function releaseNotesFor(
	workspaceDir: string,
	version: string,
	fetchImpl: typeof fetch = fetch,
	now: number = Date.now(),
): Promise<ReleaseNotes | null> {
	const cached = readReleaseNotes(workspaceDir);
	if (cached?.version === version && now - cached.fetchedAt < NOTES_TTL_MS)
		return cached;
	let fresh: ReleaseNotes;
	try {
		const res = await fetchImpl(
			`${RELEASES_API}/releases/tags/v${encodeURIComponent(version)}`,
			{
				headers: { accept: "application/vnd.github+json" },
				redirect: "error",
				signal: AbortSignal.timeout(TIMEOUT_MS),
			},
		);
		if (!res.ok) return cached?.version === version ? cached : null;
		const json = (await res.json()) as {
			body?: unknown;
			published_at?: unknown;
		};
		fresh = {
			version,
			notes:
				typeof json.body === "string" ? sanitiseReleaseNotes(json.body) : null,
			publishedAt:
				typeof json.published_at === "string" ? json.published_at : null,
			fetchedAt: now,
		};
	} catch {
		return cached?.version === version ? cached : null;
	}
	try {
		writeFileSync(
			join(workspaceDir, NOTES_FILE),
			`${JSON.stringify(fresh)}\n`,
			{ mode: 0o600 },
		);
	} catch {
		// A read-only workspace fetches again next time.
	}
	return fresh;
}

/** How long with no live run before an automatic install starts. */
export const AUTO_INSTALL_QUIET_MS = 15 * 60 * 1000;

export interface AutoInstallFacts {
	preference: "notify" | "idle";
	channel: InstallChannel;
	/** A newer release with its downloads attached. */
	available: boolean;
	/** The env switch or About toggle that turned the check off. */
	checkDisabled: boolean;
	/** A run is live now. */
	live: boolean;
	/** Epoch millis since which no run has been live. */
	quietSince: number;
	/** An install is already under way or draining. */
	installing: boolean;
	now: number;
}

/** The guards #724's button has, plus the quiet window; null means install now. */
export function autoInstallBlockedBy(
	facts: AutoInstallFacts,
):
	| "preference"
	| "not_installer"
	| "no_update"
	| "disabled"
	| "busy"
	| "quiet_window"
	| "installing"
	| null {
	if (facts.preference !== "idle") return "preference";
	if (facts.channel !== "installer") return "not_installer";
	if (facts.checkDisabled) return "disabled";
	if (!facts.available) return "no_update";
	if (facts.installing) return "installing";
	if (facts.live) return "busy";
	if (facts.now - facts.quietSince < AUTO_INSTALL_QUIET_MS)
		return "quiet_window";
	return null;
}

/**
 * True only under the unit `pl service install` writes, which sets
 * `PRISMALENS_SERVICE`: the rollback restarts that unit by name, so a user's
 * own unit (with `INVOCATION_ID` or `XPC_SERVICE_NAME`) runs as a terminal copy.
 */
export function underServiceManager(env: NodeJS.ProcessEnv): boolean {
	return env.PRISMALENS_SERVICE === "1";
}

/**
 * The exit code that makes a manager restart us: not 0 and not 143, which the
 * unit lists as success (`Restart=on-failure`, launchd `SuccessfulExit=false`).
 */
export const RESTART_EXIT_CODE = 75;

/**
 * argv that installs `version` with the installer, into its own runtime folder.
 * `script` is a local copy of the installer, which the CI upgrade job passes
 * through `PRISMALENS_INSTALLER_SCRIPT` to install a build that isn't released.
 */
export function installerArgv(
	version: string,
	platform: NodeJS.Platform = process.platform,
	script?: string,
): string[] {
	if (!/^\d+\.\d+\.\d+$/.test(version))
		throw new Error(`not a plain version: ${version}`);
	if (script)
		return platform === "win32"
			? [
					"powershell",
					"-NoProfile",
					"-ExecutionPolicy",
					"Bypass",
					"-File",
					script,
					"-Version",
					version,
				]
			: ["sh", script, "--version", version];
	return platform === "win32"
		? [
				"powershell",
				"-NoProfile",
				"-ExecutionPolicy",
				"Bypass",
				"-Command",
				`& ([scriptblock]::Create((irm https://prismalens.io/install.ps1))) -Version ${version}`,
			]
		: [
				"sh",
				"-c",
				`curl -fsSL https://prismalens.io/install.sh | sh -s -- --version ${version}`,
			];
}

/**
 * The installer's env. On Windows it drops PSModulePath: a PowerShell 7 value
 * breaks the Windows PowerShell the installer runs in (#965).
 */
export function installerEnv(
	env: NodeJS.ProcessEnv = process.env,
	platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
	if (platform !== "win32") return env;
	return Object.fromEntries(
		Object.entries(env).filter(([key]) => key.toLowerCase() !== "psmodulepath"),
	);
}
