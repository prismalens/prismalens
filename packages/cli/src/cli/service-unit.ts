// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The background service's files and the commands that drive them (#732): pure,
 * so the tests pin exactly what lands on disk and what runs. `service.ts` does
 * the I/O.
 */

import { resolve } from "node:path";
import { dirname, join } from "node:path/posix";
import {
	LAUNCHD_LABEL,
	type ServiceManagerKind,
	SYSTEMD_UNIT_NAME,
} from "@prismalens/config";

export interface ServicePlan {
	/** argv the service runs; the first entry is an absolute path. */
	program: string[];
	/** Written into the unit verbatim; a service inherits no shell. */
	env: Record<string, string>;
	logPath: string;
	/** What was left out of `env` and why; the caller prints them. */
	warnings: string[];
}

/** PRISMALENS_* settings an install carries into the unit; never a secret. */
export const CARRIED_ENV = [
	"PRISMALENS_ALLOWED_HOSTS",
	"PRISMALENS_PUBLIC_URL",
	"PRISMALENS_TELEMETRY",
	"PRISMALENS_UPDATE_CHECK",
] as const;

/** URLs npm's launcher downloads through; carried without any user:password (#717). */
const CARRIED_URLS = [
	["PRISMALENS_RELEASE_BASE_URL", "PRISMALENS_RELEASE_BASE_URL"],
	["HTTPS_PROXY", "HTTPS_PROXY"],
	["https_proxy", "HTTPS_PROXY"],
	["HTTP_PROXY", "HTTP_PROXY"],
	["http_proxy", "HTTP_PROXY"],
] as const;

/** Paths a service started from another directory must still find. */
const CARRIED_PATHS = [
	"PRISMALENS_LAUNCHER_DIR",
	"NODE_EXTRA_CA_CERTS",
] as const;

function withoutCredentials(value: string): { value: string; had: boolean } {
	try {
		const url = new URL(value);
		if (!url.username && !url.password) return { value, had: false };
		url.username = "";
		url.password = "";
		return { value: url.href.replace(/\/$/, ""), had: true };
	} catch {
		return { value, had: false };
	}
}

/** The network and launcher settings the unit gets, and a warning for each credential left out. */
export function carriedNetwork(env: NodeJS.ProcessEnv = {}): {
	env: Record<string, string>;
	warnings: string[];
} {
	const out: Record<string, string> = {};
	const warnings: string[] = [];
	for (const [from, to] of CARRIED_URLS) {
		const raw = env[from];
		if (!raw || out[to]) continue;
		const { value, had } = withoutCredentials(raw);
		out[to] = value;
		if (had)
			warnings.push(
				`${from} holds a user and password; the service gets ${value} without them, since a unit file is no place for a secret. Give the service its own credentials if the server needs them.`,
			);
	}
	const noProxy = env.NO_PROXY ?? env.no_proxy;
	if (noProxy) out.NO_PROXY = noProxy;
	for (const key of CARRIED_PATHS) if (env[key]) out[key] = resolve(env[key]);
	return { env: out, warnings };
}

export function buildPlan(input: {
	launcher: string;
	workspace: string;
	port: number;
	host?: string;
	path: string;
	env?: NodeJS.ProcessEnv;
	tailscaleServe?: boolean;
	lan?: boolean;
}): ServicePlan {
	const env: Record<string, string> = {
		PATH: input.path,
		PRISMALENS_WORKSPACE_DIR: input.workspace,
		PRISMALENS_PORT: String(input.port),
		// Tells `pl up` it is the service, so a refused manual run can say so.
		PRISMALENS_SERVICE: "1",
	};
	if (input.host) env.PRISMALENS_HOST = input.host;
	for (const key of CARRIED_ENV) {
		const value = input.env?.[key];
		if (value) env[key] = value;
	}
	const network = carriedNetwork(input.env);
	Object.assign(env, network.env);
	return {
		warnings: network.warnings,
		program: [
			input.launcher,
			"up",
			"--no-open",
			...(input.tailscaleServe ? ["--tailscale-serve"] : []),
			...(input.lan ? ["--lan"] : []),
		],
		env,
		logPath: join(input.workspace, "logs", "service.log"),
	};
}

/** The stable `pl` to run: the installer's wrapper and npm's launcher survive upgrades; the runtime they exec does not. */
export function resolveLauncher(input: {
	channel: string;
	argv1: string;
	installerBinDir: string | null;
	npmLauncher?: string;
}): string {
	if (input.channel === "installer" && input.installerBinDir) {
		return join(input.installerBinDir, "pl");
	}
	if (input.channel === "npm" && input.npmLauncher) return input.npmLauncher;
	return input.argv1;
}

/** The installing shell's PATH, plus the node running now and the usual system dirs. */
export function servicePath(shellPath: string, execPath: string): string {
	const dirs = [
		...shellPath.split(":"),
		dirname(execPath),
		"/opt/homebrew/bin",
		"/usr/local/bin",
		"/usr/bin",
		"/bin",
	];
	return [...new Set(dirs.filter((d) => d.startsWith("/")))].join(":");
}

function systemdQuote(value: string): string {
	return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%")}"`;
}

export function renderSystemdUnit(plan: ServicePlan): string {
	return [
		"[Unit]",
		"Description=PrismaLens",
		"StartLimitIntervalSec=300",
		"StartLimitBurst=5",
		"",
		"[Service]",
		"Type=simple",
		"WorkingDirectory=%h",
		...Object.entries(plan.env).map(
			([key, value]) => `Environment=${systemdQuote(`${key}=${value}`)}`,
		),
		`ExecStart=${plan.program.map(systemdQuote).join(" ")}`,
		// `pl up` exits 143 on SIGTERM once it has released the workspace lock.
		"SuccessExitStatus=143",
		// Agents run as children in this cgroup; one killed for memory must not stop the server.
		"OOMPolicy=continue",
		"Restart=on-failure",
		"RestartSec=5",
		`StandardOutput=append:${plan.logPath.replaceAll("%", "%%")}`,
		`StandardError=append:${plan.logPath.replaceAll("%", "%%")}`,
		"",
		"[Install]",
		"WantedBy=default.target",
		"",
	].join("\n");
}

function xml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

export function renderLaunchdPlist(plan: ServicePlan, home: string): string {
	return [
		`<?xml version="1.0" encoding="UTF-8"?>`,
		`<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">`,
		`<plist version="1.0">`,
		`<dict>`,
		`  <key>Label</key>`,
		`  <string>${LAUNCHD_LABEL}</string>`,
		`  <key>ProgramArguments</key>`,
		`  <array>`,
		...plan.program.map((arg) => `    <string>${xml(arg)}</string>`),
		`  </array>`,
		`  <key>EnvironmentVariables</key>`,
		`  <dict>`,
		...Object.entries(plan.env).flatMap(([key, value]) => [
			`    <key>${key}</key>`,
			`    <string>${xml(value)}</string>`,
		]),
		`  </dict>`,
		`  <key>WorkingDirectory</key>`,
		`  <string>${xml(home)}</string>`,
		`  <key>RunAtLoad</key>`,
		`  <true/>`,
		`  <key>KeepAlive</key>`,
		`  <dict>`,
		`    <key>SuccessfulExit</key>`,
		`    <false/>`,
		`  </dict>`,
		`  <key>ThrottleInterval</key>`,
		`  <integer>5</integer>`,
		`  <key>ProcessType</key>`,
		`  <string>Interactive</string>`,
		`  <key>StandardOutPath</key>`,
		`  <string>${xml(plan.logPath)}</string>`,
		`  <key>StandardErrorPath</key>`,
		`  <string>${xml(plan.logPath)}</string>`,
		`</dict>`,
		`</plist>`,
		``,
	].join("\n");
}

export interface Step {
	argv: string[];
	/** A failure here is expected in some states (not loaded yet) and ignored. */
	optional?: boolean;
}

export type Action = "start" | "stop" | "restart" | "remove";

/** Exits 0 while the unit is running (systemd) or loaded (launchd). */
export function activeProbe(kind: ServiceManagerKind, uid: number): string[] {
	return kind === "systemd"
		? ["systemctl", "--user", "is-active", "--quiet", SYSTEMD_UNIT_NAME]
		: ["launchctl", "print", `gui/${uid}/${LAUNCHD_LABEL}`];
}

export function steps(
	kind: ServiceManagerKind,
	action: Action,
	unitPath: string,
	uid: number,
): Step[] {
	if (kind === "systemd") {
		const ctl = (...args: string[]) => ({
			argv: ["systemctl", "--user", ...args],
		});
		switch (action) {
			case "start":
				return [
					ctl("daemon-reload"),
					ctl("enable", SYSTEMD_UNIT_NAME),
					ctl("restart", SYSTEMD_UNIT_NAME),
				];
			case "stop":
				return [ctl("stop", SYSTEMD_UNIT_NAME)];
			case "restart":
				return [ctl("restart", SYSTEMD_UNIT_NAME)];
			case "remove":
				return [
					{ ...ctl("disable", "--now", SYSTEMD_UNIT_NAME), optional: true },
				];
		}
	}
	const domain = `gui/${uid}`;
	const target = `${domain}/${LAUNCHD_LABEL}`;
	switch (action) {
		case "start":
			return [
				{ argv: ["launchctl", "bootout", target], optional: true },
				{ argv: ["launchctl", "enable", target], optional: true },
				{ argv: ["launchctl", "bootstrap", domain, unitPath] },
			];
		case "stop":
		case "remove":
			return [{ argv: ["launchctl", "bootout", target], optional: true }];
		case "restart":
			return [{ argv: ["launchctl", "kickstart", "-k", target] }];
	}
}
