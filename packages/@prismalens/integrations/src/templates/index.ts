// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AuthTemplate } from "../types.js";
import { alertmanager } from "./alertmanager.js";
import { gitHostToken } from "./git-host-token.js";
import { githubToken } from "./github.js";
import { isLegacyTemplateId } from "./legacy.js";
import { prometheus } from "./prometheus.js";
import { render } from "./render.js";

export { alertmanager } from "./alertmanager.js";
export { gitHostToken } from "./git-host-token.js";
export { githubToken } from "./github.js";
export { isLegacyTemplateId, LEGACY_TEMPLATE_IDS } from "./legacy.js";
export { prometheus } from "./prometheus.js";
export { render } from "./render.js";

const TEMPLATES = new Map<string, AuthTemplate>([
	[alertmanager.id, alertmanager],
	[gitHostToken.id, gitHostToken],
	[githubToken.id, githubToken],
	[prometheus.id, prometheus],
	[render.id, render],
]);

export function getTemplate(id: string): AuthTemplate | undefined {
	const template = TEMPLATES.get(id);
	if (!template && !isLegacyTemplateId(id)) {
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
