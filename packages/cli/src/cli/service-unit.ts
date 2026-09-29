// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The background service's files and the commands that drive them (#732): pure,
 * so the tests pin exactly what lands on disk and what runs. `service.ts` does
 * the I/O.
 */

import { dirname, join } from "node:path";
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
}

/** PRISMALENS_* settings an install carries into the unit; never a secret. */
export const CARRIED_ENV = [
	"PRISMALENS_ALLOWED_HOSTS",
	"PRISMALENS_PUBLIC_URL",
	"PRISMALENS_TELEMETRY",
	"PRISMALENS_UPDATE_CHECK",
] as const;

export function buildPlan(input: {
	launcher: string;
	workspace: string;
	port: number;
	host?: string;
	path: string;
	env?: NodeJS.ProcessEnv;
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
	return {
		program: [input.launcher, "up", "--no-open"],
		env,
		logPath: join(input.workspace, "logs", "service.log"),
	};
}

/** The stable `pl` to run: the installer's wrapper survives upgrades; the runtime it execs does not. */
export function resolveLauncher(input: {
	channel: string;
	argv1: string;
	installerBinDir: string | null;
}): string {
	if (input.channel === "installer" && input.installerBinDir) {
		return join(input.installerBinDir, "pl");
	}
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
