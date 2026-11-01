// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Server } from "node:http";
import { Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { getOrCreateAuthSecret } from "@prismalens/config";
import type { Request } from "express";
import { OperatorResolver } from "../../core/auth/operator.resolver.js";
import {
	defaultShell,
	loadPtyFactory,
	type PtyFactory,
	shellEnv,
} from "./pty.js";
import { TerminalGate } from "./terminal-gate.js";
import { devOrigin } from "./terminal-key-issue.js";
import { TerminalSocketServer } from "./terminal-socket.js";

@Injectable()
export class TerminalService implements OnApplicationShutdown {
	readonly gate = new TerminalGate({
		secret: () => getOrCreateAuthSecret(),
		devOrigin: devOrigin(),
	});
	private pty?: Promise<PtyFactory | null>;
	private sockets?: TerminalSocketServer;

	constructor(private readonly operator: OperatorResolver) {}

	loadPty(): Promise<PtyFactory | null> {
		this.pty ??= loadPtyFactory();
		return this.pty;
	}

	/** Called once the server listens; upgrades for other paths are left alone. */
	attach(server: Server): void {
		this.sockets = new TerminalSocketServer({
			gate: this.gate,
			authenticate: async (req) =>
				(await this.operator.resolve(req as Request))?.device ?? null,
			loadPty: () => this.loadPty(),
			shell: () => defaultShell(),
			env: () => shellEnv(),
		});
		// Nothing else upgrades; an unknown or malformed target is dropped, never left hanging.
		server.on("upgrade", (req, socket, head) => {
			if (!this.sockets?.handleUpgrade(req, socket, head)) socket.destroy();
		});
	}

	onApplicationShutdown(): void {
		this.sockets?.closeAll();
	}
}
