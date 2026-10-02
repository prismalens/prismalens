// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Publish this instance on the tailnet with `tailscale serve` HTTPS (#765).
 * Everything goes through the `tailscale` CLI; nothing here talks to the
 * daemon or provisions certificates itself.
 */

import { spawnSync } from "node:child_process";

export interface RunResult {
	/** null when the executable could not be spawned (not installed). */
	status: number | null;
	stdout: string;
	stderr: string;
}

export type Run = (args: string[]) => RunResult;

export class TailscaleError extends Error {}

export const runTailscale: Run = (args) => {
	const result = spawnSync(
		process.platform === "win32" ? "tailscale.exe" : "tailscale",
		args,
		{ encoding: "utf8", timeout: 15_000 },
	);
	return {
		status: result.error ? null : result.status,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
	};
};

const NOT_INSTALLED =
	"The `tailscale` command isn't on PATH. Install Tailscale (https://tailscale.com/download) and log in, then try again.";

function failure(result: RunResult, what: string): TailscaleError {
	if (result.status === null) return new TailscaleError(NOT_INSTALLED);
	const text = `${result.stderr}\n${result.stdout}`;
	if (/not logged in|logged out|needs? ?login/i.test(text)) {
		return new TailscaleError(
			"Tailscale is logged out on this machine. Run `tailscale up`, then try again.",
		);
	}
	if (/access denied|permission denied|operation not permitted/i.test(text)) {
		return new TailscaleError(
			'Tailscale refused to change serve settings for this user. Run `sudo tailscale set --operator="$(id -un)"` once, then try again.',
		);
	}
	const detail = text.trim().split("\n").slice(0, 4).join("\n");
	return new TailscaleError(
		`\`tailscale ${what}\` failed${detail ? `:\n${detail}` : "."}`,
	);
}

/** This machine's MagicDNS name, e.g. `box.tail1234.ts.net`. */
export function tailnetHostname(run: Run = runTailscale): string {
	const result = run(["status", "--json"]);
	if (result.status !== 0) throw failure(result, "status");
	let status: { BackendState?: string; Self?: { DNSName?: string } };
	try {
		status = JSON.parse(result.stdout);
	} catch {
		throw new TailscaleError("`tailscale status --json` printed no JSON.");
	}
	if (status.BackendState && status.BackendState !== "Running") {
		throw new TailscaleError(
			status.BackendState === "NeedsLogin"
				? "Tailscale is logged out on this machine. Run `tailscale up`, then try again."
				: `Tailscale isn't connected (state ${status.BackendState}). Run \`tailscale up\`, then try again.`,
		);
	}
	const name = status.Self?.DNSName?.trim().replace(/\.$/, "");
	if (!name) {
		throw new TailscaleError(
			"This machine has no MagicDNS name. Turn on MagicDNS and HTTPS certificates in the Tailscale admin console (DNS page).",
		);
	}
	return name.toLowerCase();
}

/** Where `tailscale serve` on :443 sends `/`, or null when nothing is mapped. */
export function currentServeTarget(
	hostname: string,
	run: Run = runTailscale,
): string | null {
	const result = run(["serve", "status", "--json"]);
	if (result.status !== 0) throw failure(result, "serve status");
	if (!result.stdout.trim()) return null;
	try {
		const config = JSON.parse(result.stdout) as {
			Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }>;
		};
		return config.Web?.[`${hostname}:443`]?.Handlers?.["/"]?.Proxy ?? null;
	} catch {
		throw new TailscaleError(
			"`tailscale serve status --json` printed no JSON.",
		);
	}
}

/**
 * Map https://<hostname>/ to `target`, keeping a mapping that already points
 * there and refusing to replace one that points anywhere else.
 */
export function ensureServe(
	target: string,
	run: Run = runTailscale,
): { url: string; created: boolean } {
	const hostname = tailnetHostname(run);
	const url = `https://${hostname}`;
	const existing = currentServeTarget(hostname, run);
	if (existing && sameTarget(existing, target)) return { url, created: false };
	if (existing) {
		throw new TailscaleError(
			`${url} already serves ${existing}. Remove it with \`tailscale serve --https=443 off\` first, or pick that one.`,
		);
	}
	const result = run(["serve", "--bg", "--https=443", target]);
	if (result.status !== 0) throw failure(result, "serve");
	return { url, created: true };
}

function sameTarget(a: string, b: string): boolean {
	const norm = (s: string) =>
		s.replace(/\/$/, "").replace("//localhost:", "//127.0.0.1:");
	return norm(a) === norm(b);
}

/** The local URL tailscale should proxy to for a server bound to `host`. */
export function serveTarget(host: string | undefined, port: number): string {
	const wildcard =
		!host || ["0.0.0.0", "::", "[::]", "localhost"].includes(host);
	const name = wildcard ? "127.0.0.1" : host;
	return `http://${name.includes(":") ? `[${name}]` : name}:${port}`;
}

/** PRISMALENS_ALLOWED_HOSTS with `hostname` added; never widened to `*`. */
export function withAllowedHost(
	current: string | undefined,
	hostname: string,
): string {
	if (current?.trim() === "*") return current;
	const entries = (current ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	if (!entries.includes(hostname)) entries.push(hostname);
	return entries.join(",");
}
