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

type GenerateCodeRequest struct {
	DataQuota    int `json:"data_quota"`
	OCRQuota     int `json:"ocr_quota"`
	DurationDays int `json:"duration_days"`
	Count        int `json:"count"` // 批量生成数量
}

type AuthCode struct {
	ID           int        `json:"id"`
	Code         string     `json:"code"`
	DataQuota    int        `json:"data_quota"`
	OCRQuota     int        `json:"ocr_quota"`
	DurationDays int        `json:"duration_days"`
	UsedBy       *string    `json:"used_by"`
	UsedAt       *time.Time `json:"used_at"`
	CreatedAt    time.Time  `json:"created_at"`
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

// GenerateAuthCodes creates new authorization codes
func GenerateAuthCodes(c *gin.Context) {
	var req GenerateCodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	// Set defaults
	if req.DataQuota <= 0 {
		req.DataQuota = 10000
	}
	if req.OCRQuota <= 0 {
		req.OCRQuota = 10000
	}
	if req.DurationDays <= 0 {
		req.DurationDays = 365
	}
	if req.Count <= 0 {
		req.Count = 1
	}
	if req.Count > 100 {
		req.Count = 100 // 限制单次最多生成100个
	}

	codes := make([]string, 0, req.Count)
	for i := 0; i < req.Count; i++ {
		code := generateRandomCode()
		_, err := db.Pool.Exec(context.Background(), `
			INSERT INTO auth_codes (code, data_quota, ocr_quota, duration_days)
			VALUES ($1, $2, $3, $4)
		`, code, req.DataQuota, req.OCRQuota, req.DurationDays)
		if err != nil {
			continue // skip duplicates
		}
		codes = append(codes, code)
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "授权码生成成功",
		"codes":   codes,
		"count":   len(codes),
	})
}

// ListAuthCodes returns all authorization codes
func ListAuthCodes(c *gin.Context) {
	rows, err := db.Pool.Query(context.Background(), `
		SELECT id, code, data_quota, ocr_quota, duration_days, used_by, used_at, created_at
		FROM auth_codes ORDER BY created_at DESC
	`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to query codes"})
		return
	}
	defer rows.Close()

	var codes []AuthCode
	for rows.Next() {
		var ac AuthCode
		if err := rows.Scan(&ac.ID, &ac.Code, &ac.DataQuota, &ac.OCRQuota, &ac.DurationDays, &ac.UsedBy, &ac.UsedAt, &ac.CreatedAt); err != nil {
			continue
		}
		codes = append(codes, ac)
	}

	c.JSON(http.StatusOK, gin.H{"data": codes})
}

// DeleteAuthCode deletes an unused authorization code
func DeleteAuthCode(c *gin.Context) {
	code := c.Param("code")
	if code == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Missing code"})
		return
	}

	result, err := db.Pool.Exec(context.Background(), `
		DELETE FROM auth_codes WHERE code = $1 AND used_by IS NULL
	`, code)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete code"})
		return
	}

	if result.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Code not found or already used"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "授权码已删除"})
}
