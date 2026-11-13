// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

export const modelsNewThread = define.setting({
	id: "models.newThread",
	page: "models",
	anchor: "harness-run-row",
	label: "New thread",
	sentence: "The agent and model a thread you start takes.",
	also: "model default agent next run",
});

export const modelsAlertRun = define.setting({
	id: "models.alertRun",
	page: "models",
	anchor: "models-use-alert",
	label: "Alert run",
	sentence: "Runs an alert starts, with nobody watching.",
	also: "model incident unattended",
});

export const modelsThreadTitles = define.setting({
	id: "models.threadTitles",
	page: "models",
	anchor: "models-titles",
	label: "Thread titles",
	sentence: "The small model that names each new thread, its length and style.",
	also: "title name rename untitled",
});

export const modelsOrganizer = define.setting({
	id: "models.organizer",
	page: "models",
	anchor: "models-use-organizer",
	label: "Organizer",
	sentence:
		"The thread you start organizes the threads its agent starts, so it runs on New thread.",
	also: "model",
});

export const modelsDelegate = define.setting({
	id: "models.delegate",
	page: "models",
	anchor: "models-use-delegate",
	label: "Delegate",
	sentence: "Threads an agent starts; an agent may still name its own.",
	also: "model child sub thread",
});

export const modelsEffort = define.setting({
	id: "models.effort",
	page: "models",
	anchor: "harness-effort",
	label: "Effort",
	sentence: "How hard the agent thinks, and its context window.",
	also: "reasoning thinking",
});

export const modelsAuto = define.setting({
	id: "models.auto",
	page: "models",
	anchor: "harness-auto-row",
	label: "Auto",
	sentence: "Picks the first agent that can run.",
});
