// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Controller, Get } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EnvironmentVariables } from "@prismalens/config";
import { Public } from "../../core/auth/public.decorator.js";

interface HealthResponse {
	status: "ok" | "degraded" | "error";
	timestamp: string;
	version: string;
	services: {
		api: boolean;
	};
}

/**
 * The installed `prismalens` package's version — `pl up` wraps this API in
 * its own published tarball, so that is the version a user actually has
 * installed, not `@prismalens/api`'s own internal workspace version. Walks up
 * from this file (deep under `node_modules/@prismalens/api/dist/...` in the
 * packed tarball) until it finds that package.json, falling back to the
 * nearest package.json found along the way (this workspace package, in a dev
 * checkout where the two are sibling directories rather than nested).
 */
function resolveServiceVersion(): string {
	let dir = dirname(fileURLToPath(import.meta.url));
	let fallback: string | undefined;
	for (let i = 0; i < 10; i++) {
		try {
			const pkg = JSON.parse(
				readFileSync(join(dir, "package.json"), "utf8"),
			) as { name?: string; version?: string };
			if (pkg.name === "prismalens" && pkg.version) return pkg.version;
			if (!fallback && pkg.version) fallback = pkg.version;
		} catch {
			// not here — keep walking up
		}
		dir = dirname(dir);
	}
	return fallback ?? "0.0.0";
}

@Public()
@Controller("health")
export class HealthController {
	constructor(readonly _configService: ConfigService<EnvironmentVariables>) {}

	@Get()
	health(): HealthResponse {
		return {
			status: "ok",
			timestamp: new Date().toISOString(),
			version: resolveServiceVersion(),
			services: {
				api: true,
			},
		};
	}

	@Get("ready")
	ready(): { ready: boolean } {
		return { ready: true };
	}

	@Get("live")
	live(): { live: boolean } {
		return { live: true };
	}
}
