package middleware

import (
	"crypto/rand"
	"encoding/hex"

	"bbflow-server/logging"

	"github.com/gin-gonic/gin"
)

// RequestID generates or propagates a unique request ID for every request.
func RequestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.GetHeader("X-Request-ID")
		if id == "" {
			b := make([]byte, 8)
			rand.Read(b)
			id = hex.EncodeToString(b)
		}
		c.Set("request_id", id)
		c.Writer.Header().Set("X-Request-ID", id)
		c.Request = c.Request.WithContext(logging.ContextWithRequestID(c.Request.Context(), id))
		c.Next()
	}
}
