import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "isPublic";

/**
 * Mark a controller or route as publicly accessible.
 * Skips the global AuthGuard session check.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
