// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** One redaction for `redact` in redact.ts, off the API's event loop (#842). */
import { parentPort, workerData } from "node:worker_threads";
import type { ArtifactPurpose } from "@prismalens/contracts";
import type * as Redact from "./redact.js";

const job = workerData as { purpose: ArtifactPurpose; raw: Uint8Array };
// Sources run under Node's type stripping, which needs the real extension.
const ext = import.meta.url.endsWith(".ts") ? "ts" : "js";
const { redactInProcess }: typeof Redact = await import(`./redact.${ext}`);
const out = await redactInProcess(
	job.purpose,
	Buffer.from(job.raw.buffer, job.raw.byteOffset, job.raw.byteLength),
);
parentPort?.postMessage(out);
