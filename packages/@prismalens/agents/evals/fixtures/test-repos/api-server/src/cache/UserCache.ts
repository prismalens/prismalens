import { User } from '../models';

/**
 * In-memory user cache for fast lookups.
 * WARNING: This implementation has unbounded growth!
 */
export class UserCache {
  private cache = new Map<string, User>();
  private static instance: UserCache;

  static getInstance(): UserCache {
    if (!UserCache.instance) {
      UserCache.instance = new UserCache();
    }
    return UserCache.instance;
  }

  get(userId: string): User | undefined {
    return this.cache.get(userId);
  }

  set(userId: string, user: User): void {
    // BUG: No eviction policy, no TTL, no size limit
    // Memory grows unbounded as more users are cached
    this.cache.set(userId, user);
  }

  // NOTE: clear() is never called anywhere
  clear(): void {
    this.cache.clear();
  }
}
