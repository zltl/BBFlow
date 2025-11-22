import rateLimit from 'express-rate-limit';
import { pool } from '../db';

// Cache for user limits to avoid DB hit on every request
// Map<openid, { config: any, timestamp: number }>
const limitCache = new Map<string, { config: any, timestamp: number }>();
const CACHE_TTL = 60 * 1000; // 1 minute

async function getUserConfig(openid: string) {
  const now = Date.now();
  const cached = limitCache.get(openid);
  if (cached && (now - cached.timestamp < CACHE_TTL)) {
    return cached.config;
  }

  try {
    const res = await pool.query('SELECT rate_limit_config FROM users WHERE openid = $1', [openid]);
    const config = res.rows[0]?.rate_limit_config || {};
    limitCache.set(openid, { config, timestamp: now });
    return config;
  } catch (err) {
    console.error('Error fetching user rate limit config:', err);
    return {};
  }
}

const createDynamicLimiter = (type: string, defaultLimit: number, windowMs: number = 60 * 1000) => {
  return rateLimit({
    windowMs,
    max: async (req: any) => {
      // If user is authenticated (req.user is set by authenticateToken)
      if (req.user && req.user.openid) {
        const config = await getUserConfig(req.user.openid);
        // Check for specific type override
        if (config && config[type] !== undefined) {
          return Number(config[type]);
        }
      }
      return defaultLimit;
    },
    message: { error: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: any) => {
        // Use openid if available, otherwise IP
        return req.user?.openid || req.ip;
    },
    validate: {
      trustProxy: false
    }
  });
};

// 1. Record Page (Write operations) - Strict
// Default: 10 requests per minute AND 30 requests per day
const recordMinuteLimiter = createDynamicLimiter('record_minute', 10, 60 * 1000);
const recordDayLimiter = createDynamicLimiter('record_day', 30, 24 * 60 * 60 * 1000);
export const recordLimiter = [recordMinuteLimiter, recordDayLimiter];

// 2. Trend Page (Read heavy, complex calculation) - Moderate
// Default: 60 requests per minute
export const trendLimiter = createDynamicLimiter('trend', 60);

// 3. History Page (Read heavy, pagination) - Moderate
// Default: 60 requests per minute
export const historyLimiter = createDynamicLimiter('history', 60);

// 4. Share Generation (Write) - Strict
// Default: 5 requests per minute
export const shareGenLimiter = createDynamicLimiter('share_gen', 5);

// 5. Share View (Public, IP based) - Moderate
// Default: 30 requests per minute per IP
export const shareViewLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many requests.' },
  standardHeaders: true,
  legacyHeaders: false,
});
