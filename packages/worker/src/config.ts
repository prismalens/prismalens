import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const configSchema = z.object({
	REDIS_URL: z.string().default("redis://localhost:6379"),
	API_URL: z.string().default("http://localhost:5367/api"),
	WORKER_CONCURRENCY: z.coerce.number().default(5),
	QUEUE_NAME: z.string().default("investigation"),
	NODE_ENV: z
		.enum(["development", "production", "test"])
		.default("development"),
});

export type Config = z.infer<typeof configSchema>;

export const config = configSchema.parse(process.env);
