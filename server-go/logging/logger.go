package logging

import (
	"context"
	"log/slog"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
)

type ctxKey string

const requestIDKey ctxKey = "request_id"

// Init initializes the global structured logger with JSON output.
func Init(level string) {
	var lvl slog.Level
	switch strings.ToLower(level) {
	case "debug":
		lvl = slog.LevelDebug
	case "warn", "warning":
		lvl = slog.LevelWarn
	case "error":
		lvl = slog.LevelError
	default:
		lvl = slog.LevelInfo
	}
	handler := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: lvl})
	slog.SetDefault(slog.New(handler))
}

// ContextWithRequestID returns a new context with the given request ID.
func ContextWithRequestID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, requestIDKey, id)
}

// RequestIDFromContext extracts the request ID from context.
func RequestIDFromContext(ctx context.Context) string {
	if id, ok := ctx.Value(requestIDKey).(string); ok {
		return id
	}
	return ""
}

// FromContext returns a logger with the request ID from the context attached.
func FromContext(ctx context.Context) *slog.Logger {
	if id := RequestIDFromContext(ctx); id != "" {
		return slog.Default().With("request_id", id)
	}
	return slog.Default()
}

// FromGin returns a logger derived from the Gin context's request ID.
func FromGin(c *gin.Context) *slog.Logger {
	if id := c.GetString("request_id"); id != "" {
		return slog.Default().With("request_id", id)
	}
	return slog.Default()
}
