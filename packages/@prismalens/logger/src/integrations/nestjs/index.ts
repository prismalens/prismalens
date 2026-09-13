// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { inspect } from "node:util";
import {
	type DynamicModule,
	Injectable,
	Module,
	type LoggerService as NestLoggerService,
	Scope,
} from "@nestjs/common";
import { getRequestId } from "../../core/context.js";
import { Logger } from "../../core/logger.js";
import type { ServiceInfo } from "../../index.js";

export interface LoggerModuleOptions {
	service: ServiceInfo;
	global?: boolean;
}

export const LOGGER_OPTIONS = Symbol("LOGGER_OPTIONS");

@Injectable({ scope: Scope.TRANSIENT })
export class LoggerService implements NestLoggerService {
	private logger = new Logger();
	private context?: string;

	setContext(context: string): this {
		this.context = context;
		this.logger = this.logger.child(context);
		return this;
	}

	getContext() {
		return this.context;
	}

	log(msg: unknown, ...p: unknown[]) {
		this.emit("info", msg, p);
	}
	warn(msg: unknown, ...p: unknown[]) {
		this.emit("warn", msg, p);
	}
	debug?(msg: unknown, ...p: unknown[]) {
		this.emit("debug", msg, p);
	}
	verbose?(msg: unknown, ...p: unknown[]) {
		this.emit("debug", msg, p);
	}
	fatal?(msg: unknown, ...p: unknown[]) {
		this.error(msg, ...p);
	}

	error(msg: unknown, ...params: unknown[]) {
		const ctx = this.extractContext(params);
		const l = ctx ? this.logger.child(ctx) : this.logger;
		const stack = params.find(
			(p) => typeof p === "string" && p.includes("\n"),
		) as string | undefined;
		const err = stack ? new Error(this.format(msg)) : undefined;
		if (err && stack) err.stack = stack;
		l.error(this.format(msg), err ?? this.extractArgs(params)[0]);
	}

	enrich(data: Record<string, unknown>) {
		this.logger.enrich(data);
	}
	getRequestId() {
		return getRequestId();
	}

	private emit(
		level: "info" | "warn" | "debug",
		message: unknown,
		params: unknown[],
	) {
		const ctx = this.extractContext(params);
		(ctx ? this.logger.child(ctx) : this.logger)[level](
			this.format(message),
			...this.extractArgs(params),
		);
	}

	private format(message: unknown): string {
		if (typeof message === "string") return message;
		if (message instanceof Error) return message.message;
		// inspect, not JSON.stringify: circular refs and bigint must not throw inside a log call.
		return inspect(message, {
			depth: 4,
			breakLength: Number.POSITIVE_INFINITY,
		});
	}

	private extractContext(params: unknown[]) {
		const last = params[params.length - 1];
		return typeof last === "string" && !last.includes("\n")
			? last
			: this.context;
	}

	private extractArgs(params: unknown[]) {
		const last = params[params.length - 1];
		return typeof last === "string" && !last.includes("\n")
			? params.slice(0, -1).filter((p) => p !== undefined)
			: params.filter((p) => p !== undefined);
	}
}

@Module({})
// biome-ignore lint/complexity/noStaticOnlyClass: NestJS dynamic module pattern
export class LoggerModule {
	static forRoot(options: LoggerModuleOptions): DynamicModule {
		Logger.setServiceInfo(options.service);
		return {
			module: LoggerModule,
			global: options.global !== false,
			providers: [
				LoggerService,
				{ provide: LOGGER_OPTIONS, useValue: options },
			],
			exports: [LoggerService, LOGGER_OPTIONS],
		};
	}
}
