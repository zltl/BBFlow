package handlers

import (
	"context"
	"net/http"
	"time"

	"bbflow-server/db"

	"github.com/gin-gonic/gin"
)

type UserInfoResponse struct {
	OpenID          string     `json:"openid"`
	IsAdmin         bool       `json:"is_admin"`
	IsPaid          bool       `json:"is_paid"`
	IsSponsored     bool       `json:"is_sponsored"`
	PaidUntil       *time.Time `json:"paid_until"`
	SponsorID       *string    `json:"sponsor_id"`
	MaxInviteLinks  int        `json:"max_invite_links"`
	DataQuota       int        `json:"data_quota"`
	OCRQuota        int        `json:"ocr_quota"`
	DataUsed        int        `json:"data_used"`
	OCRUsed         int        `json:"ocr_used"`
	QuotaIsDaily    bool       `json:"quota_is_daily"`
	DataQuotaPeriod string     `json:"data_quota_period"` // "daily", "monthly", "total"
	OCRQuotaPeriod  string     `json:"ocr_quota_period"`  // "daily", "monthly", "total"
}

func GetUserInfo(c *gin.Context) {
	openid := c.GetString("openid")
	if openid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	ctx := context.Background()

	var isAdmin bool
	var paidUntil *time.Time
	var sponsorID *string
	var maxInviteLinks int
	err := db.Pool.QueryRow(ctx, `
		SELECT COALESCE(is_admin, false), paid_until, sponsor_id, COALESCE(max_invite_links, 0)
		FROM users WHERE openid = $1
	`, openid).Scan(&isAdmin, &paidUntil, &sponsorID, &maxInviteLinks)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get user info"})
		return
	}

	status, err := getUserPaidStatus(ctx, openid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to check paid status"})
		return
	}

	resp := UserInfoResponse{
		OpenID:         openid,
		IsAdmin:        isAdmin,
		IsPaid:         status.IsPaid,
		IsSponsored:    status.IsSponsored,
		PaidUntil:      paidUntil,
		SponsorID:      sponsorID,
		MaxInviteLinks: maxInviteLinks,
	}

	if isAdmin {
		resp.DataQuota = AdminDailyDataQuota
		resp.OCRQuota = AdminDailyOCRQuota
		resp.QuotaIsDaily = true
		resp.DataQuotaPeriod = "daily"
		resp.OCRQuotaPeriod = "daily"
	} else if status.IsPaid || status.IsSponsored {
		resp.DataQuota = PaidDailyDataQuota
		resp.OCRQuota = PaidDailyOCRQuota
		resp.QuotaIsDaily = true
		resp.DataQuotaPeriod = "daily"
		resp.OCRQuotaPeriod = "daily"
	} else {
		resp.DataQuota = FreeDailyDataQuota
		resp.OCRQuota = FreeMonthlyOCRQuota
		resp.QuotaIsDaily = false
		resp.DataQuotaPeriod = "daily"
		resp.OCRQuotaPeriod = "monthly"
	}

	if _, used, limit, err := checkQuota(ctx, openid, "data"); err == nil {
		resp.DataUsed = used
		if limit > 0 {
			resp.DataQuota = limit
		}
	}
	if _, used, limit, err := checkQuota(ctx, openid, "ocr"); err == nil {
		resp.OCRUsed = used
		if limit > 0 {
			resp.OCRQuota = limit
		}
	}

	c.JSON(http.StatusOK, resp)
}
