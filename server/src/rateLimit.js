/**
 * Simple In-Memory Rate Limiter
 * Protection against spam and abuse.
 */

const limits = new Map();

/**
 * Check if an action is within rate limits.
 * @returns {boolean} True if allowed, False if limit exceeded
 */
function checkLimit(key, limit, windowMs) {
    const now = Date.now();
    const record = limits.get(key);

    if (!record || now > record.resetAt) {
        limits.set(key, {
            count: 1,
            resetAt: now + windowMs
        });
        return true;
    }

    if (record.count >= limit) {
        return false;
    }

    record.count++;
    return true;
}

/**
 * Cleanup expired keys
 */
setInterval(() => {
    const now = Date.now();
    for (const [key, record] of limits.entries()) {
        if (now > record.resetAt) {
            limits.delete(key);
        }
    }
}, 60 * 60 * 1000); // run every hour

module.exports = { checkLimit };
