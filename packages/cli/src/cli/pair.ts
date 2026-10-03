// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * `pl pair` — mint a one-time link that lets another device reach this
 * instance (ADR 0004 §8). Runs on the host, straight against the workspace
 * database, the same way `pl reset` does: whoever can run it already
 * holds the workspace, so it grants nothing new.
 */

import { defineCommand } from "citty";
import consola from "consola";
import {
	checkIdentity,
	describeOutcome,
	lockBase,
	type ProbeOptions,
	probeInstance,
} from "./instance-check.js";
import {
	ensureServe,
	removeServe,
	serveTarget,
	TailscaleError,
} from "./tailscale.js";

export default defineCommand({
	meta: {
		name: "pair",
		description:
			"Print a one-time link that pairs another device with this instance",
	},
	args: {
		workspace: {
			type: "string",
			description:
				"Workspace holding the database (default ~/.prismalens, or PRISMALENS_WORKSPACE_DIR)",
		},
		address: {
			type: "string",
			description:
				"An address the other device will open, e.g. a reverse proxy or tailnet IP; prefer --tailscale (default: this machine's loopback, which reaches only this machine)",
		},
		label: {
			type: "string",
			description:
				"A name for the device, shown in Settings until it sends its own",
		},
		tailscale: {
			type: "boolean",
			description:
				"A link on this machine's tailnet HTTPS address; sets up `tailscale serve` for the running server if missing",
		},
		operator: {
			type: "boolean",
			description:
				"A link for this machine's own browser: it may also pair and revoke devices",
		},
	},
	async run({ args }) {
		if (args.workspace) {
			process.env.PRISMALENS_WORKSPACE_DIR = String(args.workspace);
		}
		const { getAppDataDir, readInstanceFile, readWorkspaceLock } = await import(
			"@prismalens/config"
		);
		const workspaceDir = getAppDataDir();
		const lock = readWorkspaceLock(workspaceDir);
		if (!lock) {
			consola.error(
				`No \`pl up\` is running on ${workspaceDir}. Start it, then pair.`,
			);
			process.exit(1);
		}

		if (args.tailscale && args.address) {
			consola.error("Pass --tailscale or --address, not both.");
			process.exit(1);
		}
		let address = args.address ? String(args.address) : undefined;
		let createdServe: string | null = null;
		if (args.tailscale) {
			try {
				const target = serveTarget(lock.host, lock.port);
				const served = ensureServe(target);
				if (served.created) createdServe = target;
				if (served.created)
					consola.info(`Now serving ${served.url} with tailscale serve.`);
				address = served.url;
			} catch (error) {
				if (!(error instanceof TailscaleError)) throw error;
				consola.error(error.message);
				process.exit(1);
			}
		}
		const { origin, loopback } = resolveOrigin(address, lock.port);
		const refusal = await pairRefusal({
			lock,
			instanceId: readInstanceFile(workspaceDir)?.instanceId ?? null,
			address: address ? origin : null,
		});
		if (refusal) {
			consola.error(refusal);
			if (args.tailscale) {
				consola.info("Or restart it with `pl up --tailscale-serve`.");
			}
			if (createdServe) {
				try {
					removeServe(createdServe);
				} catch (error) {
					if (!(error instanceof TailscaleError)) throw error;
					consola.warn(error.message);
				}
			}
			process.exit(1);
		}

		const {
			buildPairingUrl,
			createPairingLinkInWorkspace,
			OPERATOR_SCOPES,
			STARTUP_LINK_LABEL,
			WorkspaceError,
		} = await import("@prismalens/auth");
		try {
			const link = await createPairingLinkInWorkspace(workspaceDir, {
				label: args.operator
					? STARTUP_LINK_LABEL
					: args.label
						? String(args.label)
						: undefined,
				scopes: args.operator ? OPERATOR_SCOPES : undefined,
			});
			consola.log(`\n  ${buildPairingUrl(origin, link.token)}\n`);
			consola.info(
				`Open it ${args.operator ? "in this machine's browser" : "on the other device"} within 15 minutes. It works once; treat it as a password.`,
			);
			if (loopback && !args.operator) {
				consola.warn(
					"This address reaches only this machine. For another device, pass --tailscale, or --address with an address it can reach.",
				);
			}
		} catch (error) {
			if (error instanceof WorkspaceError) {
				consola.error(error.message);
				process.exit(1);
			}
			throw error;
		}
	},
});

/** The origin the link carries; loopback unless the operator named an address. */
export function resolveOrigin(
	address: string | undefined,
	port: number,
): { origin: string; loopback: boolean } {
	if (!address) {
		return { origin: `http://localhost:${port}`, loopback: true };
	}
	const withScheme = /^https?:\/\//i.test(address)
		? address
		: `http://${address}`;
	const url = new URL(withScheme);
	if (!url.port && url.protocol === "http:") url.port = String(port);
	const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
	return { origin: url.origin, loopback };
}

/** Why no link should be minted, or null: the lock's server and `--address` must both be this workspace's. */
export async function pairRefusal(
	input: {
		lock: { pid: number; host?: string; port: number };
		instanceId: string | null;
		address: string | null;
	},
	options: ProbeOptions & { isAlive?: (pid: number) => boolean } = {},
): Promise<string | null> {
	if (!input.instanceId) {
		return "This workspace has no instance.json yet. Restart `pl up` with this version, then pair.";
	}
	const base = lockBase(input.lock);
	const local = await checkIdentity(
		{ pid: input.lock.pid, base, instanceId: input.instanceId },
		options,
	);
	if (local.kind !== "ok") {
		return `Not pairing: ${describeOutcome(local, base)}.`;
	}
	if (!input.address) return null;
	const remote = await probeInstance(input.address, input.instanceId, options);
	return remote.kind === "ok"
		? null
		: `Not pairing: ${describeOutcome(remote, input.address)}${remote.kind === "forbidden-host" ? "" : "."}`;
}
