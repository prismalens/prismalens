// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	removeStoredCredential,
	setStoredCredential,
} from "@prismalens/config/auth";
import { resolveCredentials } from "@prismalens/config/credentials";
import { LLM_PROVIDERS, type LLMProviderId } from "@prismalens/config/llm";
import { defineCommand } from "citty";
import consola from "consola";

const login = defineCommand({
	meta: {
		name: "login",
		description: "Log in to a model provider",
	},
	args: {
		provider: {
			type: "positional",
			description: "Provider ID (e.g. openai, anthropic)",
			required: true,
		},
		"api-key": {
			type: "string",
			description: "API key",
		},
	},
	async run({ args }) {
		const provider = args.provider as LLMProviderId;
		if (!LLM_PROVIDERS[provider]) {
			consola.error(`Unknown provider: ${provider}`);
			process.exit(1);
		}

		let apiKey = args["api-key"];
		if (!apiKey) {
			if (process.stdin.isTTY) {
				apiKey = (await consola.prompt(
					`Enter API key for ${LLM_PROVIDERS[provider].name}:`,
					{
						// @ts-expect-error type password passes through to clack
						type: "password",
					},
				)) as unknown as string;
			} else {
				consola.error("--api-key is required in non-interactive mode");
				process.exit(1);
			}
		}

		if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
			consola.error("API key is required");
			process.exit(1);
		}

		setStoredCredential(provider, apiKey.trim());
		consola.success(`Saved credential for ${LLM_PROVIDERS[provider].name}`);
	},
});

const list = defineCommand({
	meta: {
		name: "list",
		description: "List configured providers",
	},
	async run() {
		for (const provider of Object.values(LLM_PROVIDERS)) {
			const creds = resolveCredentials(provider.id);
			if (creds.source !== "none") {
				const key = creds.apiKey ?? "";
				const masked = key.length > 4 ? `...${key.slice(-4)}` : "<set>";
				consola.log(`${provider.name} (${provider.id})`);
				consola.log(`  Source: ${creds.source}`);
				consola.log(`  Key:    ${masked}`);
				consola.log("");
			} else {
				consola.log(`${provider.name} (${provider.id})`);
				consola.log(`  Source: none`);
				consola.log("");
			}
		}
	},
});

const logout = defineCommand({
	meta: {
		name: "logout",
		description: "Remove stored credential",
	},
	args: {
		provider: {
			type: "positional",
			description: "Provider ID",
			required: true,
		},
	},
	async run({ args }) {
		const provider = args.provider as LLMProviderId;
		if (!LLM_PROVIDERS[provider]) {
			consola.error(`Unknown provider: ${provider}`);
			process.exit(1);
		}

		removeStoredCredential(provider);
		consola.success(
			`Removed stored credential for ${LLM_PROVIDERS[provider].name}`,
		);
	},
});

export default defineCommand({
	meta: {
		name: "auth",
		description: "Manage provider credentials",
	},
	subCommands: {
		login,
		list,
		logout,
	},
});
