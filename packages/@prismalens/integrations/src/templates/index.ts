import type { AuthTemplate } from "../types.js";
import { githubOAuth2, githubToken } from "./github.js";
import { prometheus } from "./prometheus.js";
import { render } from "./render.js";
import { slack, slackToken } from "./slack.js";

export { githubOAuth2, githubToken } from "./github.js";
export { prometheus } from "./prometheus.js";
export { render } from "./render.js";
export { slack, slackToken } from "./slack.js";

const TEMPLATES = new Map<string, AuthTemplate>([
	[githubOAuth2.id, githubOAuth2],
	[githubToken.id, githubToken],
	[slack.id, slack],
	[slackToken.id, slackToken],
	[prometheus.id, prometheus],
	[render.id, render],
]);

export function getTemplate(id: string): AuthTemplate | undefined {
	return TEMPLATES.get(id);
}

export function getAllTemplates(): AuthTemplate[] {
	return Array.from(TEMPLATES.values());
}

export function getTemplatesByCategory(
	category: string,
): AuthTemplate[] {
	return getAllTemplates().filter((t) => t.category === category);
}

export function getTemplatesByAuthMode(
	authMode: string,
): AuthTemplate[] {
	return getAllTemplates().filter((t) => t.authMode === authMode);
}
