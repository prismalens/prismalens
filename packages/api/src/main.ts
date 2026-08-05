// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import * as fs from "node:fs";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config/dist/index.js";
import { NestFactory } from "@nestjs/core";
import { getConfig } from "@prismalens/config";
import { Logger } from "@prismalens/logger";
import { AppModule } from "./app.module.js";
import { createHelmetMiddleware } from "./middlewares/helmet.middleware.js";
import {
	createHostAllowlistMiddleware,
	isLoopbackBindAddress,
	resolveAllowedHostnames,
} from "./middlewares/host-allowlist.middleware.js";
import {
	API_GLOBAL_PREFIX,
	API_GLOBAL_PREFIX_EXCLUDE,
	WEBHOOK_RUNTIME_PATH_PREFIX,
} from "./shared/constants/routes.js";

// Set service info for all loggers
Logger.setServiceInfo({
	name: "prismalens-api",
	version: "0.1.0",
	environment: process.env.NODE_ENV ?? "development",
});

async function bootstrap() {
	/**
	 * PRE-BOOTSTRAP VALIDATION (Fail Fast)
	 * This runs BEFORE NestJS even starts. If a critical variable is missing,
	 * the process crashes here without wasting memory on the Nest container.
	 */
	try {
		getConfig();
	} catch (error) {
		console.error("❌ Environment validation failed before bootstrap:");
		console.error(error.message);
		process.exit(1);
	}

	const logger = new Logger({ context: "Bootstrap" });

	// Create an initial context to read config before creating the full app (optional pattern)
	// or just use process.env here if we want to bootstrap create method options.
	// However, pure Nest approach is passing httpsOptions to factory.
	// Let's read env vars directly for bootstrap config to keep it simple and robust
	// as ConfigService isn't available until App is created.

	const protocol = getConfig().PRISMALENS_PROTOCOL || "http";
	let httpsOptions: { key: Buffer; cert: Buffer } | undefined;

	if (protocol === "https") {
		const keyPath = getConfig().PRISMALENS_SSL_KEY;
		const certPath = getConfig().PRISMALENS_SSL_CERT;

		if (keyPath && certPath) {
			if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
				httpsOptions = {
					key: fs.readFileSync(keyPath),
					cert: fs.readFileSync(certPath),
				};
			} else {
				logger.error(
					`SSL Key or Cert file not found. Key: ${keyPath}, Cert: ${certPath}`,
				);
				process.exit(1);
			}
		} else {
			logger.error(
				"PRISMALENS_PROTOCOL is https but PRISMALENS_SSL_KEY or PRISMALENS_SSL_CERT is missing.",
			);
			process.exit(1);
		}
	}

	const app = await NestFactory.create(AppModule, {
		httpsOptions,
		bodyParser: false, // Required for oRPC to handle body parsing
	});

	const configService = app.get(ConfigService);

	// Load encrypted LLM credentials from DB into process.env
	// This must run early so LLM factories can resolve API keys from env
	const llmSettingsService = app.get(
		(await import("./core/settings/llm-settings.service.js"))
			.LlmSettingsService,
	);
	await llmSettingsService.loadLlmCredentialsToEnv();

	const publicUrl = configService.get<string>("PRISMALENS_PUBLIC_URL");
	const corsOrigins = configService.get<string>("PRISMALENS_CORS_ORIGIN");

	// Refused before anything reads it: a wildcard with credentials is a
	// vulnerability, not a configuration.
	if (corsOrigins?.trim() === "*") {
		logger.error(
			'PRISMALENS_CORS_ORIGIN="*" is not allowed with credentials. ' +
				'Use specific origins like "https://example.com,https://app.example.com"',
		);
		process.exit(1);
	}

	// Security response headers. Registered first so every response carries
	// them — including the allowlist's own 403s, which would otherwise leak
	// `X-Powered-By` and ship without a CSP.
	app.use(createHelmetMiddleware({ https: Boolean(httpsOptions) }));

	// Host/Origin allowlist — DNS-rebinding defence. Runs before any guard,
	// pipe, route or static asset sees the request; helmet ahead of it only
	// sets response headers. See the middleware for the rules.
	const { hostnames: allowedHostnames, disabled: hostCheckDisabled } =
		resolveAllowedHostnames({
			allowedHosts: configService.get<string>("PRISMALENS_ALLOWED_HOSTS"),
			publicUrl,
			domain: configService.get<string>("PRISMALENS_DOMAIN"),
			corsOrigins,
		});

	if (hostCheckDisabled) {
		logger.warn(
			'PRISMALENS_ALLOWED_HOSTS="*" — the Host/Origin allowlist is DISABLED. ' +
				"This re-opens the DNS-rebinding class against public routes " +
				"(login, session, setup). Prefer listing the hostnames you actually use.",
		);
	}

	app.use(
		createHostAllowlistMiddleware({
			allowedHostnames,
			disabled: hostCheckDisabled,
			// Webhook routes are deliberately cross-origin-reachable when
			// PRISMALENS_CORS_WEBHOOK_OPEN is set, and authenticate with
			// signatures rather than cookies. Their Host is still checked.
			originExemptPathPrefixes: configService.get<boolean>(
				"PRISMALENS_CORS_WEBHOOK_OPEN",
			)
				? [WEBHOOK_RUNTIME_PATH_PREFIX]
				: [],
		}),
	);

	// Cross-origin access to the API is OFF unless an operator asks for it.
	// The app serves the SPA and the API from one origin (ADR-0029), so the
	// browser never makes a cross-origin call to these routes — in dev the Vite
	// server proxies `/api` rather than fetching it cross-origin. Webhooks keep
	// their own permissive, credential-free CORS middleware (AppModule).
	// Whatever is granted here is also on the Host/Origin allowlist above, or
	// the grant would be 403'd before CORS ever ran.
	if (corsOrigins) {
		const allowedOrigins = corsOrigins
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);

		app.enableCors({
			origin: allowedOrigins,
			credentials: true, // Allow cookies for dashboard authentication
			methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
			allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
		});

		logger.info(`CORS enabled for origins: ${allowedOrigins.join(", ")}`);
	} else {
		logger.info(
			"CORS disabled (single-origin serving). Set PRISMALENS_CORS_ORIGIN to " +
				"allow a specific external origin.",
		);
	}

	// Global validation pipe
	app.useGlobalPipes(
		new ValidationPipe({
			whitelist: true,
			transform: true,
			forbidNonWhitelisted: true,
		}),
	);

	// API prefix
	app.setGlobalPrefix(API_GLOBAL_PREFIX, {
		exclude: API_GLOBAL_PREFIX_EXCLUDE,
	});

	// Prefer PRISMALENS_PORT/HOST over generics if available in Config setup (mapped in schemas/Global)
	// But schemas map them to defaults.
	// Let's use the explicit PRISMALENS_ keys from config service which we added to Global schema.
	const port = configService.get<number>("PRISMALENS_PORT", 3001);
	const host = configService.get<string>("PRISMALENS_HOST", "127.0.0.1");

	// A non-loopback bind puts the app on the network. That is a supported
	// opt-in, but it must never be silent: Ollama's default-open bind is how
	// hundreds of thousands of hosts ended up internet-exposed.
	if (!isLoopbackBindAddress(host)) {
		logger.warn(
			`Binding to ${host} — PrismaLens is reachable from the network, not just this machine. ` +
				"Make sure it sits behind a trusted network boundary, and list the hostnames " +
				"you reach it by in PRISMALENS_ALLOWED_HOSTS.",
		);
	}

	await app.listen(port, host);

	const protocolDisplay = httpsOptions ? "https" : "http";
	logger.info(`PrismaLens API running on ${protocolDisplay}://${host}:${port}`);
	logger.info(`Health check: ${protocolDisplay}://${host}:${port}/health`);
	logger.info(`API endpoints: ${protocolDisplay}://${host}:${port}/api`);
	logger.info(
		`API documentation: ${protocolDisplay}://${host}:${port}/api/docs`,
	);
}

bootstrap();
