/**
 * Express Request augmentation
 *
 * Adds typed `user` and `session` properties to Express Request,
 * populated by AuthGuard from Better Auth's getSession().
 */

import type { Session, User } from "@prismalens/auth";

declare module "express" {
	interface Request {
		user?: User;
		session?: Session;
	}
}
