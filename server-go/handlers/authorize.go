package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"bbflow-server/db"

	"github.com/gin-gonic/gin"
)

type AuthorizeRequest struct {
	Code string `json:"code"`
}

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
		c.JSON(http.StatusBadRequest, gin.H{"error": "Missing authorization code"})
		return
	}

	// Query the auth_codes table
	var dataQuota, ocrQuota, durationDays int
	var usedBy *string
	err := db.Pool.QueryRow(context.Background(), `
		SELECT data_quota, ocr_quota, duration_days, used_by FROM auth_codes WHERE code = $1
	`, req.Code).Scan(&dataQuota, &ocrQuota, &durationDays, &usedBy)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "无效的授权码"})
		return
	}

	if usedBy != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "该授权码已被使用"})
		return
	}

	// Mark code as used
	_, err = db.Pool.Exec(context.Background(), `
		UPDATE auth_codes SET used_by = $1, used_at = $2 WHERE code = $3
	`, openid, time.Now(), req.Code)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to mark code as used"})
		return
	}

	// Build rate limit config
	cfg := map[string]interface{}{
		"authorized": true,
		"data_quota": dataQuota,
		"ocr_quota":  ocrQuota,
		"expires_at": time.Now().Add(time.Duration(durationDays) * 24 * time.Hour).Format(time.RFC3339),
	}
	cfgBytes, _ := json.Marshal(cfg)

	_, err = db.Pool.Exec(context.Background(), `
		UPDATE users
		SET rate_limit_config = $2::jsonb
		WHERE openid = $1
	`, openid, string(cfgBytes))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update user authorization"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "授权成功", "rate_limit_config": cfg})
}
