import { getWorkerConfig, buildRedisUrl } from "@prismalens/config";

const config = getWorkerConfig();

export { config };

/** Pre-built Redis URL from structured PRISMALENS_REDIS_* env vars */
export const redisUrl = buildRedisUrl(config);
