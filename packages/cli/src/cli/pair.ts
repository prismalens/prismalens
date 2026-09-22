// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * `pl pair` — mint a one-time link that lets another device reach this
 * instance (ADR 0004 §8). Runs on the host, straight against the workspace
 * database, the same way `pl reset-password` does: whoever can run it already
 * holds the workspace, so it grants nothing new.
 */

import { defineCommand } from "citty";
import consola from "consola";

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
				"The address the other device will open, e.g. http://192.168.1.5:3001 (default: this machine's loopback, which reaches only this machine)",
		},
		label: {
			type: "string",
			description:
				"A name for the device, shown in Settings until it sends its own",
		},
	},
	async run({ args }) {
		if (args.workspace) {
			process.env.PRISMALENS_WORKSPACE_DIR = String(args.workspace);
		}
		const { getAppDataDir, readWorkspaceLock } = await import(
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

		const { origin, loopback } = resolveOrigin(
			args.address ? String(args.address) : undefined,
			lock.port,
		);

		const { prisma } = await import("@prismalens/database");
		const { buildPairingUrl, createPairingLink, prismaPairingStore } =
			await import("@prismalens/auth");
		try {
			const link = await createPairingLink(prismaPairingStore(prisma), {
				label: args.label ? String(args.label) : undefined,
			});
			consola.log(`\n  ${buildPairingUrl(origin, link.token)}\n`);
			consola.info(
				`Open it on the other device within 15 minutes. It works once; treat it as a password.`,
			);
			if (loopback) {
				consola.warn(
					"This address reaches only this machine. Pass --address with an address the other device can reach (LAN IP, tailnet name).",
				);
			}
		} finally {
			await prisma.$disconnect();
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
