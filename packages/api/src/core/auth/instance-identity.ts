// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Injectable } from "@nestjs/common";
// biome-ignore lint/style/useImportType: Nest DI needs the runtime class.
import { ConfigService } from "@nestjs/config";
import { deviceCookieName } from "@prismalens/auth";
import {
	ensureAppDataDir,
	ensureInstanceFile,
	type InstanceFile,
} from "@prismalens/config";

/** This instance's id from `<workspace>/instance.json` (#763), and the names derived from it. */
@Injectable()
export class InstanceIdentity {
	private instance?: InstanceFile;

	constructor(private readonly config: ConfigService) {}

	get instanceId(): string {
		this.instance ??= ensureInstanceFile(ensureAppDataDir());
		return this.instance.instanceId;
	}

	get deviceCookie(): string {
		return deviceCookieName(this.instanceId);
	}

	/** `Secure` follows the resolved origin's scheme, never NODE_ENV. */
	get secureCookies(): boolean {
		const publicUrl = this.config.get<string>("PRISMALENS_PUBLIC_URL");
		if (publicUrl) return publicUrl.startsWith("https://");
		return this.config.get<string>("PRISMALENS_PROTOCOL") === "https";
	}
}
