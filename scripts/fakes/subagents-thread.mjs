#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// A chat thread whose agent sends two in-session helpers, for the sim sheet: the transcript
// shows each as a collapsed sub-agent node, never a row in the list (#1101 cat 10.1).
//   node scripts/fakes/subagents-thread.mjs --url <base>
import {
	ACTIVE,
	arg,
	connect,
	startThread,
	waitFor,
} from "./conditions/lib.mjs";

const url = (arg("--url") ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const { api } = await connect(url);
const id = await startThread(api, "subagents-flat", "Send two helpers");
await waitFor(api, id, (r) => !ACTIVE.includes(r.status), 120_000);
console.log(`the helpers ran in thread ${id}`);
