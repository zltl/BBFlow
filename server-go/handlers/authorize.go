package handlers

import (
	"context"
	"net/http"
	"time"

	"bbflow-server/db"

	"github.com/gin-gonic/gin"
)

type AuthorizeRequest struct {
	Code string `json:"code"`
}

// Authorize activates a user via an activation link code
func Authorize(c *gin.Context) {
	var req AuthorizeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	openidIF, exists := c.Get("openid")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	openid := openidIF.(string)

	if req.Code == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Missing activation code"})
		return
	}

	// Query the activation_links table
	var durationDays, maxInviteLinks int
	var usedBy *string
	err := db.Pool.QueryRow(context.Background(), `
		SELECT duration_days, max_invite_links, used_by FROM activation_links WHERE code = $1
	`, req.Code).Scan(&durationDays, &maxInviteLinks, &usedBy)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "无效的激活码"})
		return
	}

	if usedBy != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "该激活码已被使用"})
		return
	}

	// Mark code as used
	_, err = db.Pool.Exec(context.Background(), `
		UPDATE activation_links SET used_by = $1, used_at = $2 WHERE code = $3
	`, openid, time.Now(), req.Code)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to mark code as used"})
		return
	}

	// Update user: set paid_until and max_invite_links
	paidUntil := time.Now().Add(time.Duration(durationDays) * 24 * time.Hour)
	_, err = db.Pool.Exec(context.Background(), `
		UPDATE users
		SET paid_until = $2, max_invite_links = $3
		WHERE openid = $1
	`, openid, paidUntil, maxInviteLinks)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update user"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":          "激活成功",
		"paid_until":       paidUntil.Format(time.RFC3339),
		"max_invite_links": maxInviteLinks,
	})
}
