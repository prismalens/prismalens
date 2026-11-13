// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

export const permissionsPermissionLevels = define.setting({
	id: "permissions.permissionLevels",
	page: "permissions",
	anchor: "permissions-ladder",
	label: "Permission levels",
	sentence:
		"Ask always, Auto-accept edits, Auto and Full access, and what each agent enforced.",
	also: "permission sandbox access ladder approve",
});

export const permissionsDefaultPermissionPerAgent = define.setting({
	id: "permissions.defaultPermissionPerAgent",
	page: "permissions",
	anchor: "permissions-agents",
	label: "Default permission per agent",
	sentence: "The level a thread you start takes on each agent.",
	also: "permission access full access",
});

export const permissionsWhenAnAlertRunAsks = define.setting({
	id: "permissions.whenAnAlertRunAsks",
	page: "permissions",
	anchor: "harness-alert-asks-row",
	label: "When an alert run asks",
	sentence: "Refuse at once, or wait in the thread and notify you.",
	also: "permission ask policy approval",
});

export const permissionsKeepTheGithubToken = define.setting({
	id: "permissions.keepTheGithubToken",
	page: "permissions",
	anchor: "harness-unattended-github-row",
	label: "Keep the GitHub token",
	sentence: "Whether alert and schedule runs can push and comment as you.",
	also: "permission git token",
});
