import type { Allowlist } from "@prismalens/engine";

/**
 * Default read-only shell allowlist for the in-process investigation engine.
 *
 * Deny-by-default: only these binaries (and, where listed, only these subcommands)
 * may run. The engine additionally rejects mutating verbs and shell metacharacters
 * regardless of what is listed here (see @prismalens/engine checkCommand).
 *
 * This is a conservative SRE read-only set. It will become user-configurable from
 * Settings in a later milestone; for now it ships as a built-in default.
 */
export const DEFAULT_ENGINE_ALLOWLIST: Allowlist = {
	commands: {
		// Kubernetes — read-only inspection only.
		kubectl: {
			subcommands: [
				"get",
				"describe",
				"logs",
				"top",
				"events",
				"explain",
				"api-resources",
				"version",
			],
		},
		// systemd / logs.
		journalctl: {},
		systemctl: {
			subcommands: [
				"status",
				"is-active",
				"is-enabled",
				"list-units",
				"list-unit-files",
				"show",
			],
		},
		// Process / resource inspection.
		ps: {},
		top: { subcommands: ["-b"] },
		free: {},
		df: {},
		du: {},
		uptime: {},
		vmstat: {},
		iostat: {},
		// Networking — read-only.
		ss: {},
		netstat: {},
		ip: { subcommands: ["addr", "route", "link", "neigh"] },
		dig: {},
		nslookup: {},
		// Files / text inspection (read-only; mutating verbs still rejected by the engine).
		cat: {},
		head: {},
		tail: {},
		grep: {},
		ls: {},
		stat: {},
		wc: {},
		// Container runtimes — read-only.
		docker: {
			subcommands: [
				"ps",
				"logs",
				"inspect",
				"stats",
				"images",
				"version",
				"info",
			],
		},
	},
};
