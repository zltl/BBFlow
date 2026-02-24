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

type InviteLink struct {
	ID        int        `json:"id"`
	Code      string     `json:"code"`
	CreatorID string     `json:"creator_id"`
	UsedBy    *string    `json:"used_by"`
	UsedAt    *time.Time `json:"used_at"`
	CreatedAt time.Time  `json:"created_at"`
}

// generateInviteCode creates a random 10-character invite code
func generateInviteCode() string {
	bytes := make([]byte, 5)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
}

// CreateInviteLink creates a new invite link for a paid user
func CreateInviteLink(c *gin.Context) {
	openid := c.GetString("openid")
	if openid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	ctx := context.Background()

	// Check if user is directly paid (not just sponsored)
	status, err := getUserPaidStatus(ctx, openid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to check user status"})
		return
	}

	if !status.IsPaid {
		c.JSON(http.StatusForbidden, gin.H{"error": "仅付费用户可以创建邀请链接"})
		return
	}

	// Check how many invite links already created
	var maxLinks int
	err = db.Pool.QueryRow(ctx, `SELECT COALESCE(max_invite_links, 0) FROM users WHERE openid = $1`, openid).Scan(&maxLinks)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to check invite limit"})
		return
	}

	var currentCount int
	err = db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM invite_links WHERE creator_id = $1`, openid).Scan(&currentCount)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to count invite links"})
		return
	}

	if currentCount >= maxLinks {
		c.JSON(http.StatusForbidden, gin.H{
			"error": "已达到邀请链接上限",
			"used":  currentCount,
			"limit": maxLinks,
		})
		return
	}

	// Generate invite code
	code := generateInviteCode()
	_, err = db.Pool.Exec(ctx, `
		INSERT INTO invite_links (code, creator_id) VALUES ($1, $2)
	`, code, openid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create invite link"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "邀请链接创建成功",
		"code":    code,
		"used":    currentCount + 1,
		"limit":   maxLinks,
	})
}

// ListInviteLinks returns all invite links created by the current user
func ListInviteLinks(c *gin.Context) {
	openid := c.GetString("openid")
	if openid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	ctx := context.Background()
	rows, err := db.Pool.Query(ctx, `
		SELECT id, code, creator_id, used_by, used_at, created_at
		FROM invite_links WHERE creator_id = $1 ORDER BY created_at DESC
	`, openid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to query invite links"})
		return
	}
	defer rows.Close()

	var links []InviteLink
	for rows.Next() {
		var link InviteLink
		if err := rows.Scan(&link.ID, &link.Code, &link.CreatorID, &link.UsedBy, &link.UsedAt, &link.CreatedAt); err != nil {
			continue
		}
		links = append(links, link)
	}

	// Also get the max_invite_links for this user
	var maxLinks int
	db.Pool.QueryRow(ctx, `SELECT COALESCE(max_invite_links, 0) FROM users WHERE openid = $1`, openid).Scan(&maxLinks)

	c.JSON(http.StatusOK, gin.H{
		"data":  links,
		"used":  len(links),
		"limit": maxLinks,
	})
}

// UseInviteLink lets a user accept an invite and become sponsored
func UseInviteLink(c *gin.Context) {
	openid := c.GetString("openid")
	if openid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	var req struct {
		Code string `json:"code"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Code == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请提供邀请码"})
		return
	}

	ctx := context.Background()

	// Find the invite link
	var creatorID string
	var usedBy *string
	err := db.Pool.QueryRow(ctx, `
		SELECT creator_id, used_by FROM invite_links WHERE code = $1
	`, req.Code).Scan(&creatorID, &usedBy)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的邀请码"})
		return
	}

	if usedBy != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "该邀请码已被使用"})
		return
	}

	// Cannot invite yourself
	if creatorID == openid {
		c.JSON(http.StatusBadRequest, gin.H{"error": "不能使用自己创建的邀请码"})
		return
	}

	// Check creator is still paid
	creatorStatus, err := getUserPaidStatus(ctx, creatorID)
	if err != nil || !creatorStatus.IsPaid {
		c.JSON(http.StatusBadRequest, gin.H{"error": "邀请链接创建者已过期，该邀请无效"})
		return
	}

	// Mark invite link as used
	_, err = db.Pool.Exec(ctx, `
		UPDATE invite_links SET used_by = $1, used_at = $2 WHERE code = $3
	`, openid, time.Now(), req.Code)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to use invite link"})
		return
	}

	// Set sponsor_id on the user (only if they don't already have a paid status)
	// If user is already paid, just record the relationship but don't downgrade
	_, err = db.Pool.Exec(ctx, `
		UPDATE users SET sponsor_id = $1 WHERE openid = $2
	`, creatorID, openid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to bind sponsor"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "邀请绑定成功，享受付费用户权益"})
}
