// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { buildRedisUrl, getWorkerConfig } from "@prismalens/config";

const config = getWorkerConfig();

export { config };

/** Pre-built Redis URL from structured PRISMALENS_REDIS_* env vars */
export const redisUrl = buildRedisUrl(config);
