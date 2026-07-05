// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AuthTemplate } from "../types.js";
import { githubApp, githubToken } from "./github.js";
import { prometheus } from "./prometheus.js";
import { render } from "./render.js";
import { slack, slackToken } from "./slack.js";
import { vercel } from "./vercel.js";

export { githubApp, githubToken } from "./github.js";
export { prometheus } from "./prometheus.js";
export { render } from "./render.js";
export { slack, slackToken } from "./slack.js";
export { vercel } from "./vercel.js";

const TEMPLATES = new Map<string, AuthTemplate>([
	[githubApp.id, githubApp],
	[githubToken.id, githubToken],
	[slack.id, slack],
	[slackToken.id, slackToken],
	[prometheus.id, prometheus],
	[render.id, render],
	[vercel.id, vercel],
]);

export function getTemplate(id: string): AuthTemplate | undefined {
	const template = TEMPLATES.get(id);
	if (!template) {
		console.warn(
			`Template '${id}' not found — connection may reference a removed template`,
		);
	}
	return template;
}

export function getAllTemplates(): AuthTemplate[] {
	return Array.from(TEMPLATES.values());
}

export function getTemplatesByCategory(
	category: AuthTemplate["category"],
): AuthTemplate[] {
	return getAllTemplates().filter((t) => t.category === category);
}

export function getTemplatesByAuthMode(authMode: string): AuthTemplate[] {
	return getAllTemplates().filter((t) => t.authMode === authMode);
}
