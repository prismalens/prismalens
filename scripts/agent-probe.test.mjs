// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { ROWS, speak, summarize } from "./agent-probe.mjs";
import { FAKE_AGENT_PATH } from "./fakes/fake-acp-agent.mjs";

const cwd = mkdtempSync(join(tmpdir(), "agent-probe-"));
after(() => rmSync(cwd, { recursive: true, force: true }));

test("every agent row the registry lists has a probe entry", () => {
	assert.deepEqual(
		ROWS.map((r) => r.id),
		["opencode", "claude-code", "codex", "gemini", "deepagents"],
	);
});

test("an agent that answers initialize and session/new reads as ok, without any model", async () => {
	const answer = await speak(
		{ command: process.execPath, env: {} },
		[FAKE_AGENT_PATH, "--session", "success"],
		cwd,
	);
	const summary = summarize(answer);
	assert.equal(summary.ok, true, summary.text);
	assert.match(
		summary.text,
		/protocol 1, fake-acp-agent|protocol 1, claude-agent-acp/,
	);
	assert.match(summary.text, /session\/new ok, 6 modes/);
});

test("the caps name session/resume and replayComplete when the agent offers them (#942)", () => {
	const caps = (agentCapabilities) =>
		summarize({
			initialize: { result: { protocolVersion: 1, agentCapabilities } },
			session: { result: {} },
		}).text;
	assert.match(
		caps({
			loadSession: true,
			sessionCapabilities: { resume: {}, replayComplete: {} },
		}),
		/caps loadSession\+resume\+replayComplete;/,
	);
	assert.match(
		caps({ loadSession: true, sessionCapabilities: { resume: null } }),
		/caps loadSession;/,
	);
});

test("an agent that cannot start session/new is reported with its own reason", () => {
	const summary = summarize({
		initialize: {
			result: { protocolVersion: 1, agentInfo: { name: "x", version: "9" } },
		},
		session: { error: { message: "Gemini API key is missing" } },
	});
	assert.equal(summary.ok, false);
	assert.match(summary.text, /session\/new failed: Gemini API key is missing/);
});

test("an agent that never answers initialize is reported, not thrown", () => {
	assert.equal(summarize({ initialize: null, session: null }).ok, false);
	assert.match(
		summarize({
			initialize: { error: { message: "exited early" } },
			session: null,
		}).text,
		/initialize failed: exited early/,
	);
});
