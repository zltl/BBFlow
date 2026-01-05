package handlers

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"

	"bbflow-server/db"

	"github.com/gin-gonic/gin"
)

type UserInfoResponse struct {
	OpenID       string  `json:"openid"`
	IsAdmin      bool    `json:"is_admin"`
	Authorized   bool    `json:"authorized"`
	DataQuota    int     `json:"data_quota"`
	OCRQuota     int     `json:"ocr_quota"`
	ReferralCode string  `json:"referral_code"`
	ReferrerID   *string `json:"referrer_id"`
}

// generateReferralCode creates a unique 8-character referral code
func generateReferralCode() string {
	bytes := make([]byte, 4)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
}

func GetUserInfo(c *gin.Context) {
	openid := c.GetString("openid")
	if openid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	var isAdmin bool
	var rlConfig *string
	var referralCode *string
	var referrerID *string
	err := db.Pool.QueryRow(context.Background(), `
		SELECT COALESCE(is_admin, false), rate_limit_config::text, referral_code, referrer_id
		FROM users WHERE openid = $1
	`, openid).Scan(&isAdmin, &rlConfig, &referralCode, &referrerID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get user info"})
		return
	}

	// 如果用户没有推荐码，生成一个
	if referralCode == nil || *referralCode == "" {
		newCode := generateReferralCode()
		_, err = db.Pool.Exec(context.Background(), `
			UPDATE users SET referral_code = $1 WHERE openid = $2
		`, newCode, openid)
		if err == nil {
			referralCode = &newCode
		}
	}

	resp := UserInfoResponse{
		OpenID:       openid,
		IsAdmin:      isAdmin,
		Authorized:   false,
		DataQuota:    DefaultDataQuota,
		OCRQuota:     DefaultOCRQuota,
		ReferralCode: "",
		ReferrerID:   referrerID,
	}
	if referralCode != nil {
		resp.ReferralCode = *referralCode
	}

	if rlConfig != nil && *rlConfig != "" && *rlConfig != "{}" {
		var cfg map[string]interface{}
		if err := json.Unmarshal([]byte(*rlConfig), &cfg); err == nil {
			if authorized, ok := cfg["authorized"].(bool); ok && authorized {
				resp.Authorized = true
			}
			if dq, ok := cfg["data_quota"].(float64); ok && dq > 0 {
				resp.DataQuota = int(dq)
			}
			if oq, ok := cfg["ocr_quota"].(float64); ok && oq > 0 {
				resp.OCRQuota = int(oq)
			}
		}
	}

	c.JSON(http.StatusOK, resp)
}

type BindReferrerRequest struct {
	ReferralCode string `json:"referral_code"`
}

// BindReferrer 绑定推荐人
func BindReferrer(c *gin.Context) {
	openid := c.GetString("openid")
	if openid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	var req BindReferrerRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.ReferralCode == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请输入推荐码"})
		return
	}

	// 查找推荐码对应的用户
	var referrerOpenID string
	err := db.Pool.QueryRow(context.Background(), `
		SELECT openid FROM users WHERE referral_code = $1
	`, req.ReferralCode).Scan(&referrerOpenID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "推荐码无效"})
		return
	}

	// 不能推荐自己
	if referrerOpenID == openid {
		c.JSON(http.StatusBadRequest, gin.H{"error": "不能使用自己的推荐码"})
		return
	}

	// 检查是否已经绑定过推荐人
	var existingReferrer *string
	err = db.Pool.QueryRow(context.Background(), `
		SELECT referrer_id FROM users WHERE openid = $1
	`, openid).Scan(&existingReferrer)
	if err != nil {
		// 用户不存在，忽略绑定（用户登录后会自动创建）
		c.JSON(http.StatusOK, gin.H{"message": "请先登录"})
		return
	}
	if existingReferrer != nil && *existingReferrer != "" {
		c.JSON(http.StatusOK, gin.H{"message": "已绑定过推荐人"})
		return
	}

	// 绑定推荐人
	_, err = db.Pool.Exec(context.Background(), `
		UPDATE users SET referrer_id = $1 WHERE openid = $2
	`, referrerOpenID, openid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "绑定失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "推荐人绑定成功"})
}
