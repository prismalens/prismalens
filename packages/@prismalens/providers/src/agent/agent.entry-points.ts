// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineEntryPoint } from "../descriptor.ts";

export const settingsAgents = defineEntryPoint({
	id: "settings.agents",
	family: "agent",
	required: true,
	about:
		"Settings → Agents: each agent's readiness, sign-in and permission level.",
	screen: "packages/frontend/src/components/settings/HarnessSettings.tsx",
});

export const composerAgent = defineEntryPoint({
	id: "thread.composer-agent",
	family: "agent",
	required: true,
	about: "The composer's agent picker, where a run chooses its agent.",
	screen: "packages/frontend/src/components/thread/Composer.tsx",
});

export const scheduleAgent = defineEntryPoint({
	id: "schedules.agent",
	family: "agent",
	required: true,
	about: "A schedule's agent, which every scheduled run starts on.",
	screen: "packages/frontend/src/routes/_authenticated/schedules/$id.tsx",
});
