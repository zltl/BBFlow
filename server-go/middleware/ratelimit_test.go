package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func init() {
	gin.SetMode(gin.TestMode)
}

func TestRateLimiter_BlocksAfterLimit(t *testing.T) {
	rl := newRateLimiter(3, time.Minute)
	for i := 0; i < 3; i++ {
		if !rl.allow("user1") {
			t.Fatalf("request %d should be allowed", i+1)
		}
	}
	if rl.allow("user1") {
		t.Fatal("4th request should be blocked")
	}
}

func TestRateLimiter_ResetsAfterWindow(t *testing.T) {
	rl := newRateLimiter(1, 50*time.Millisecond)
	if !rl.allow("user1") {
		t.Fatal("first request should be allowed")
	}
	if rl.allow("user1") {
		t.Fatal("second request should be blocked")
	}
	time.Sleep(60 * time.Millisecond)
	if !rl.allow("user1") {
		t.Fatal("request after window reset should be allowed")
	}
}

func TestRateLimitMiddleware_PerUserIsolation(t *testing.T) {
	handler := RateLimitMiddleware(1, time.Minute)

	// User A
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("openid", "userA")
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	handler(c)
	if w.Code == http.StatusTooManyRequests {
		t.Fatal("userA first request should pass")
	}

	// User B should not be affected
	w2 := httptest.NewRecorder()
	c2, _ := gin.CreateTestContext(w2)
	c2.Set("openid", "userB")
	c2.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	handler(c2)
	if w2.Code == http.StatusTooManyRequests {
		t.Fatal("userB first request should pass (isolated from userA)")
	}
}

func TestRequestID_GeneratesID(t *testing.T) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	RequestID()(c)
	id := c.GetString("request_id")
	if id == "" {
		t.Fatal("request_id should be set")
	}
	if w.Header().Get("X-Request-ID") != id {
		t.Fatal("X-Request-ID header should match")
	}
}

func TestRequestID_PropagatesExistingID(t *testing.T) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	c.Request.Header.Set("X-Request-ID", "incoming-id-123")
	RequestID()(c)
	if c.GetString("request_id") != "incoming-id-123" {
		t.Fatalf("expected propagated ID, got %s", c.GetString("request_id"))
	}
}
