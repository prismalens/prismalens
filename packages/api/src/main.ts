import { Logger, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config/dist/index.js";
import { NestFactory } from "@nestjs/core";
import { getConfig } from "@prismalens/config";
import * as fs from "fs";
import { AppModule } from "./app.module.js";

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

	const logger = new Logger("Bootstrap");

	// Create an initial context to read config before creating the full app (optional pattern)
	// or just use process.env here if we want to bootstrap create method options.
	// However, pure Nest approach is passing httpsOptions to factory.
	// Let's read env vars directly for bootstrap config to keep it simple and robust
	// as ConfigService isn't available until App is created.

	const protocol = getConfig().PRISMALENS_PROTOCOL || "http";
	let httpsOptions;

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

	// Enable CORS for main API (restrictive - allowlist only)
	// Webhooks have their own permissive CORS middleware applied in AppModule
	const corsOrigins = configService.get<string>("PRISMALENS_CORS_ORIGIN");
	const dashboardUrl = configService.get<string>(
		"PRISMALENS_DASHBOARD_BASE_URL",
	);

	let allowedOrigins: string[] = [];

	if (corsOrigins) {
		if (corsOrigins === "*") {
			// Security: Block wildcard with credentials - this is a vulnerability
			logger.error(
				'PRISMALENS_CORS_ORIGIN="*" is not allowed with credentials. ' +
					'Use specific origins like "http://example.com,http://localhost:3000"',
			);
			process.exit(1);
		}
		allowedOrigins = corsOrigins.split(",").map((s) => s.trim());
	} else {
		// Safe defaults: localhost dev + dashboard URL if configured
		allowedOrigins = ["http://localhost:3000"];
		if (dashboardUrl) {
			allowedOrigins.push(dashboardUrl);
		}
	}

	app.enableCors({
		origin: allowedOrigins,
		credentials: true, // Allow cookies for dashboard authentication
		methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
		allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
	});

	logger.log(`CORS enabled for origins: ${allowedOrigins.join(", ")}`);

	// Global validation pipe
	app.useGlobalPipes(
		new ValidationPipe({
			whitelist: true,
			transform: true,
			forbidNonWhitelisted: true,
		}),
	);

	// API prefix
	app.setGlobalPrefix("api", {
		exclude: ["health", "/"],
	});

	// Prefer PRISMALENS_PORT/HOST over generics if available in Config setup (mapped in schemas/Global)
	// But schemas map them to defaults.
	// Let's use the explicit PRISMALENS_ keys from config service which we added to Global schema.
	const port = configService.get<number>("PRISMALENS_PORT", 5367);
	const host = configService.get<string>("PRISMALENS_HOST", "localhost");

	await app.listen(port, host);

	const protocolDisplay = httpsOptions ? "https" : "http";
	logger.log(`PrismaLens API running on ${protocolDisplay}://${host}:${port}`);
	logger.log(`Health check: ${protocolDisplay}://${host}:${port}/health`);
	logger.log(`API endpoints: ${protocolDisplay}://${host}:${port}/api`);
	logger.log(
		`API documentation: ${protocolDisplay}://${host}:${port}/api/docs`,
	);
}

bootstrap();
