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
	/** Why spawning failed, when status is null. */
	error?: NodeJS.ErrnoException;
}

export type Run = (args: string[]) => RunResult;

export class TailscaleError extends Error {}

export const runTailscale: Run = (args) => {
	const result = spawnSync(
		process.platform === "win32" ? "tailscale.exe" : "tailscale",
		args,
		{ encoding: "utf8", timeout: 90_000 },
	);
	return {
		status: result.error ? null : result.status,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
		error: result.error as NodeJS.ErrnoException | undefined,
	};
};

const NOT_INSTALLED =
	"The `tailscale` command isn't on PATH. Install Tailscale (https://tailscale.com/download) and log in, then try again.";

function failure(result: RunResult, what: string): TailscaleError {
	if (result.status === null) {
		if (!result.error || result.error.code === "ENOENT") {
			return new TailscaleError(NOT_INSTALLED);
		}
		return new TailscaleError(
			`\`tailscale ${what}\` could not run: ${result.error.message}`,
		);
	}
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
		const root = config.Web?.[`${hostname}:443`]?.Handlers?.["/"];
		if (!root) return null;
		return root.Proxy ?? "a non-proxy (text or path) handler";
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
	if (result.status !== 0) {
		if (result.error?.code === "ETIMEDOUT") {
			throw new TailscaleError(
				`Tailscale is still issuing this machine's HTTPS certificate. Run \`tailscale serve --bg --https=443 ${target}\` once, then rerun.`,
			);
		}
		throw failure(result, "serve");
	}
	return { url, created: true };
}

/** Turn off the :443 mapping, but only while it still points at `target`. */
export function removeServe(target: string, run: Run = runTailscale): void {
	const existing = currentServeTarget(tailnetHostname(run), run);
	if (!existing || !sameTarget(existing, target)) return;
	const result = run(["serve", "--https=443", "off"]);
	if (result.status !== 0) throw failure(result, "serve off");
}

function sameTarget(a: string, b: string): boolean {
	const norm = (s: string) =>
		s.replace(/\/$/, "").replace("//localhost:", "//127.0.0.1:");
	return norm(a) === norm(b);
}

/** The local URL tailscale should proxy to for a server bound to `host`. */
export function serveTarget(host: string | undefined, port: number): string {
	// tailscale serve proxies HTTP only to 127.0.0.1/localhost (#768 review).
	if (
		host &&
		!["0.0.0.0", "::", "[::]", "localhost", "127.0.0.1"].includes(host)
	) {
		throw new TailscaleError(
			`tailscale serve can only proxy to 127.0.0.1, but this server is bound to ${host}. Bind to 127.0.0.1 or 0.0.0.0 to use Tailscale.`,
		);
	}
	return `http://127.0.0.1:${port}`;
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
