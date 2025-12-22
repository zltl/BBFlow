package middleware

import (
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

type rateLimiter struct {
	mu       sync.Mutex
	requests map[string][]time.Time
	limit    int
	window   time.Duration
}

func newRateLimiter(limit int, window time.Duration) *rateLimiter {
	return &rateLimiter{
		requests: make(map[string][]time.Time),
		limit:    limit,
		window:   window,
	}
}

func (rl *rateLimiter) allow(key string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	windowStart := now.Add(-rl.window)

	// Filter requests within window
	var valid []time.Time
	for _, t := range rl.requests[key] {
		if t.After(windowStart) {
			valid = append(valid, t)
		}
	}

	if len(valid) >= rl.limit {
		rl.requests[key] = valid
		return false
	}

	rl.requests[key] = append(valid, now)
	return true
}

func RateLimitMiddleware(limit int, window time.Duration) gin.HandlerFunc {
	limiter := newRateLimiter(limit, window)

	return func(c *gin.Context) {
		key := c.GetString("openid")
		if key == "" {
			key = c.ClientIP()
		}

		if !limiter.allow(key) {
			c.JSON(http.StatusTooManyRequests, gin.H{"error": "Too many requests, please try again later."})
			c.Abort()
			return
		}

		c.Next()
	}
}

// RecordLimiter - 10 req/min
func RecordLimiter() gin.HandlerFunc {
	return RateLimitMiddleware(10, time.Minute)
}

// HistoryLimiter - 60 req/min
func HistoryLimiter() gin.HandlerFunc {
	return RateLimitMiddleware(60, time.Minute)
}

// ShareGenLimiter - 5 req/min
func ShareGenLimiter() gin.HandlerFunc {
	return RateLimitMiddleware(5, time.Minute)
}

// ShareViewLimiter - 30 req/min
func ShareViewLimiter() gin.HandlerFunc {
	return RateLimitMiddleware(30, time.Minute)
}
