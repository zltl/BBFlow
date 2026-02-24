package handlers

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"time"

	"bbflow-server/db"

	"github.com/gin-gonic/gin"
)

type GenerateActivationRequest struct {
	DurationDays   int `json:"duration_days"`
	MaxInviteLinks int `json:"max_invite_links"`
	Count          int `json:"count"`
}

type ActivationLink struct {
	ID             int        `json:"id"`
	Code           string     `json:"code"`
	DurationDays   int        `json:"duration_days"`
	MaxInviteLinks int        `json:"max_invite_links"`
	UsedBy         *string    `json:"used_by"`
	UsedAt         *time.Time `json:"used_at"`
	CreatedAt      time.Time  `json:"created_at"`
}

// AdminAuthMiddleware checks if the logged-in user is an admin
func AdminAuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		openid := c.GetString("openid")
		if openid == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Login required"})
			c.Abort()
			return
		}

		var isAdmin bool
		err := db.Pool.QueryRow(context.Background(), `SELECT COALESCE(is_admin, false) FROM users WHERE openid = $1`, openid).Scan(&isAdmin)
		if err != nil || !isAdmin {
			c.JSON(http.StatusForbidden, gin.H{"error": "Admin access denied"})
			c.Abort()
			return
		}
		c.Next()
	}
}

// generateRandomCode creates a random 12-character code
func generateRandomCode() string {
	bytes := make([]byte, 6)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
}

// GenerateActivationLinks creates new activation links
func GenerateActivationLinks(c *gin.Context) {
	var req GenerateActivationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	// Set defaults
	if req.DurationDays <= 0 {
		req.DurationDays = 365
	}
	if req.MaxInviteLinks <= 0 {
		req.MaxInviteLinks = 5
	}
	if req.Count <= 0 {
		req.Count = 1
	}
	if req.Count > 100 {
		req.Count = 100
	}

	codes := make([]string, 0, req.Count)
	for i := 0; i < req.Count; i++ {
		code := generateRandomCode()
		_, err := db.Pool.Exec(context.Background(), `
			INSERT INTO activation_links (code, duration_days, max_invite_links)
			VALUES ($1, $2, $3)
		`, code, req.DurationDays, req.MaxInviteLinks)
		if err != nil {
			continue // skip duplicates
		}
		codes = append(codes, code)
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "激活链接生成成功",
		"codes":   codes,
		"count":   len(codes),
	})
}

// ListActivationLinks returns all activation links
func ListActivationLinks(c *gin.Context) {
	rows, err := db.Pool.Query(context.Background(), `
		SELECT id, code, duration_days, max_invite_links, used_by, used_at, created_at
		FROM activation_links ORDER BY created_at DESC
	`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to query activation links"})
		return
	}
	defer rows.Close()

	var links []ActivationLink
	for rows.Next() {
		var al ActivationLink
		if err := rows.Scan(&al.ID, &al.Code, &al.DurationDays, &al.MaxInviteLinks, &al.UsedBy, &al.UsedAt, &al.CreatedAt); err != nil {
			continue
		}
		links = append(links, al)
	}

	c.JSON(http.StatusOK, gin.H{"data": links})
}

// DeleteActivationLink deletes an unused activation link
func DeleteActivationLink(c *gin.Context) {
	code := c.Param("code")
	if code == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Missing code"})
		return
	}

	result, err := db.Pool.Exec(context.Background(), `
		DELETE FROM activation_links WHERE code = $1 AND used_by IS NULL
	`, code)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete link"})
		return
	}

	if result.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Link not found or already used"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "删除成功"})
}
