package middleware

import (
	"context"
	"net/http"

	"bbflow-server/db"

	"github.com/gin-gonic/gin"
)

// Idempotency checks the Idempotency-Key header for POST requests.
// If the key was seen before, returns the cached response.
func Idempotency() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.Method != http.MethodPost {
			c.Next()
			return
		}

		key := c.GetHeader("Idempotency-Key")
		if key == "" {
			c.Next()
			return
		}

		openid := c.GetString("openid")
		ctx := context.Background()

		// Check for existing response
		var status int
		var body string
		err := db.Pool.QueryRow(ctx,
			`SELECT response_status, response_body FROM idempotency_keys WHERE key = $1 AND user_id = $2`,
			key, openid).Scan(&status, &body)
		if err == nil {
			// Found cached response
			c.Data(status, "application/json; charset=utf-8", []byte(body))
			c.Abort()
			return
		}

		// Process the request normally
		c.Next()

		// Cache the response (best effort)
		if c.Writer.Status() >= 200 && c.Writer.Status() < 500 {
			db.Pool.Exec(ctx,
				`INSERT INTO idempotency_keys (key, user_id, response_status) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
				key, openid, c.Writer.Status())
		}
	}
}
