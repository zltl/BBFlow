package handlers

import (
	"context"
	"net/http"
	"time"

	"bbflow-server/db"
	"bbflow-server/logging"

	"github.com/gin-gonic/gin"
)

// ListShareTokens returns all share tokens for the current user
func ListShareTokens(c *gin.Context) {
	openid := c.GetString("openid")
	if openid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	rows, err := db.Pool.Query(context.Background(),
		`SELECT token, time_range, share_future_data, expires_at, created_at,
		        COALESCE(is_revoked, false), access_count, last_accessed_at
		 FROM share_tokens WHERE user_id = $1 ORDER BY created_at DESC`, openid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to query share tokens"})
		return
	}
	defer rows.Close()

	type tokenInfo struct {
		Token          string     `json:"token"`
		TimeRange      string     `json:"time_range"`
		ShareFuture    bool       `json:"share_future_data"`
		ExpiresAt      time.Time  `json:"expires_at"`
		CreatedAt      time.Time  `json:"created_at"`
		IsRevoked      bool       `json:"is_revoked"`
		AccessCount    int        `json:"access_count"`
		LastAccessedAt *time.Time `json:"last_accessed_at"`
	}

	var tokens []tokenInfo
	for rows.Next() {
		var t tokenInfo
		if err := rows.Scan(&t.Token, &t.TimeRange, &t.ShareFuture, &t.ExpiresAt,
			&t.CreatedAt, &t.IsRevoked, &t.AccessCount, &t.LastAccessedAt); err != nil {
			continue
		}
		tokens = append(tokens, t)
	}

	c.JSON(http.StatusOK, gin.H{"data": tokens})
}

// RevokeShareToken revokes a share token
func RevokeShareToken(c *gin.Context) {
	log := logging.FromGin(c)
	openid := c.GetString("openid")
	if openid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	token := c.Param("token")
	if token == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Missing token"})
		return
	}

	result, err := db.Pool.Exec(context.Background(),
		`UPDATE share_tokens SET is_revoked = TRUE, revoked_at = $1
		 WHERE token = $2 AND user_id = $3 AND COALESCE(is_revoked, false) = FALSE`,
		time.Now(), token, openid)
	if err != nil {
		log.Error("failed to revoke share token", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to revoke token"})
		return
	}

	if result.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Token not found or already revoked"})
		return
	}

	log.Info("share token revoked", "token", token)
	c.JSON(http.StatusOK, gin.H{"message": "分享链接已撤销"})
}
