// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * `prismalens deploy` (#854): record a deploy from CI on any stack. Runs anywhere
 * that can reach the instance; it needs the webhook secret, not the workspace.
 */

import { defineCommand } from "citty";
import consola from "consola";
import { assertKnownFlags } from "./flags.js";

const STATUSES = ["succeeded", "failed", "started"] as const;
const DEFAULT_SERVER = "http://localhost:6473";

export interface DeployOptions {
	server: string;
	secret: string;
	service: string;
	version: string;
	environment?: string;
	status?: string;
	url?: string;
	actor?: string;
	sha?: string;
}

/** Whether the deploy was newly recorded, or why it was not. */
export async function sendDeploy(
	opts: DeployOptions,
	doFetch: typeof fetch = fetch,
): Promise<{ error: string } | { created: boolean }> {
	if (opts.status && !(STATUSES as readonly string[]).includes(opts.status))
		return { error: `--status must be one of ${STATUSES.join(", ")}.` };
	let response: Response;
	try {
		response = await doFetch(
			`${opts.server.replace(/\/+$/, "")}/api/webhooks/deploy`,
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					authorization: `Bearer ${opts.secret}`,
				},
				body: JSON.stringify({
					service: opts.service,
					version: opts.version,
					environment: opts.environment,
					status: opts.status,
					url: opts.url,
					actor: opts.actor,
					sha: opts.sha,
				}),
			},
		);
	} catch (error) {
		return {
			error: `Could not reach ${opts.server}: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
	if (response.status === 401 || response.status === 403)
		return {
			error:
				"The instance refused the secret. Pass the webhook secret it is running with.",
		};
	if (!response.ok) {
		const body = (await response.json().catch(() => null)) as {
			message?: string;
		} | null;
		return {
			error: body?.message ?? `The instance answered ${response.status}.`,
		};
	}
	const body = (await response.json()) as { created: boolean };
	return { created: body.created };
}

export default defineCommand({
	meta: {
		name: "deploy",
		description:
			"Record a deploy so investigations can see what shipped, where and when",
	},
	args: {
		service: {
			type: "string",
			required: true,
			description: "Name of the service, as listed under Services",
		},
		version: {
			type: "string",
			required: true,
			description: "Commit sha or tag that was deployed",
		},
		env: {
			type: "string",
			description: "Environment deployed to (default: production)",
		},
		status: {
			type: "string",
			description: "succeeded (default), failed or started",
		},
		url: {
			type: "string",
			description: "Link to the deploy run or release",
		},
		actor: { type: "string", description: "Who or what deployed" },
		sha: {
			type: "string",
			description: "Commit sha, when --version is a tag",
		},
		server: {
			type: "string",
			description: `The instance to record on (default: PRISMALENS_URL, else ${DEFAULT_SERVER})`,
		},
		secret: {
			type: "string",
			description:
				"The instance's webhook secret (default: PRISMALENS_WEBHOOK_SECRET)",
		},
	},
	async run({ args, cmd }) {
		assertKnownFlags(args, cmd);
		const secret = args.secret
			? String(args.secret)
			: process.env.PRISMALENS_WEBHOOK_SECRET;
		if (!secret) {
			consola.error(
				"No webhook secret. Set PRISMALENS_WEBHOOK_SECRET or pass --secret.",
			);
			process.exit(1);
		}
		const server =
			(args.server ? String(args.server) : process.env.PRISMALENS_URL) ||
			DEFAULT_SERVER;
		const result = await sendDeploy({
			server,
			secret,
			service: String(args.service),
			version: String(args.version),
			environment: args.env ? String(args.env) : undefined,
			status: args.status ? String(args.status) : undefined,
			url: args.url ? String(args.url) : undefined,
			actor: args.actor ? String(args.actor) : undefined,
			sha: args.sha ? String(args.sha) : undefined,
		});
		if ("error" in result) {
			consola.error(result.error);
			process.exit(1);
		}
		consola.success(
			result.created
				? `Recorded ${args.service} ${args.version}.`
				: `Already recorded ${args.service} ${args.version}.`,
		);
	},
});
