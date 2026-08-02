package handlers

import (
	"context"
	"fmt"
	"time"

	"bbflow-server/db"
)

const (
	// Free user limits
	FreeDailyDataQuota  = 30 // per day
	FreeMonthlyOCRQuota = 5  // per month

	// Paid/sponsored user limits (per day)
	PaidDailyDataQuota = 30
	PaidDailyOCRQuota  = 60

	// Admin limits (per day)
	AdminDailyDataQuota = 100
	AdminDailyOCRQuota  = 1000
)

// Keep legacy constant name for backward compat where referenced
const DefaultDataQuota = FreeDailyDataQuota
const DefaultOCRQuota = FreeMonthlyOCRQuota

// UserPaidStatus represents the paid status of a user
type UserPaidStatus struct {
	IsPaid      bool       // directly paid (paid_until > now)
	IsSponsored bool       // invited by a paid user whose paid_until > now
	IsAdmin     bool       // user has admin flag
	PaidUntil   *time.Time // the user's own paid_until
	SponsorID   *string    // who sponsored this user
}

// getUserPaidStatus determines if the user is paid, sponsored, or free
func getUserPaidStatus(ctx context.Context, openid string) (*UserPaidStatus, error) {
	var paidUntil *time.Time
	var sponsorID *string
	var isAdmin bool

	err := db.Pool.QueryRow(ctx, `
		SELECT paid_until, sponsor_id, COALESCE(is_admin, false) FROM users WHERE openid = $1
	`, openid).Scan(&paidUntil, &sponsorID, &isAdmin)
	if err != nil {
		return nil, fmt.Errorf("failed to get user status: %w", err)
	}

	status := &UserPaidStatus{
		PaidUntil: paidUntil,
		SponsorID: sponsorID,
		IsAdmin:   isAdmin,
	}

	// Check if directly paid
	if paidUntil != nil && paidUntil.After(time.Now()) {
		status.IsPaid = true
		return status, nil
	}

	// Check if sponsored (sponsor's paid_until > now)
	if sponsorID != nil && *sponsorID != "" {
		var sponsorPaidUntil *time.Time
		err := db.Pool.QueryRow(ctx, `
			SELECT paid_until FROM users WHERE openid = $1
		`, *sponsorID).Scan(&sponsorPaidUntil)
		if err == nil && sponsorPaidUntil != nil && sponsorPaidUntil.After(time.Now()) {
			status.IsSponsored = true
			return status, nil
		}
	}

	return status, nil
}

// checkQuota checks if user is within their quota limits.
// Admin: daily limits (100 data, 1000 OCR).
// Paid/sponsored: daily limits (30 data, 60 OCR).
// Free users: daily data (30/day), monthly OCR (5/month).
// Returns (allowed, used, limit, error)
func checkQuota(ctx context.Context, openid string, quotaType string) (bool, int, int, error) {
	status, err := getUserPaidStatus(ctx, openid)
	if err != nil {
		return false, 0, 0, err
	}

	var count int
	var limit int

	switch {
	case status.IsAdmin:
		// Admin: daily quota
		todayStart := time.Now().Truncate(24 * time.Hour)
		if quotaType == "data" {
			err = db.Pool.QueryRow(ctx,
				`SELECT COUNT(*) FROM bp_records WHERE user_id = $1 AND created_at >= $2`,
				openid, todayStart).Scan(&count)
			limit = AdminDailyDataQuota
		} else {
			err = db.Pool.QueryRow(ctx,
				`SELECT COUNT(*) FROM ocr_logs WHERE user_id = $1 AND created_at >= $2`,
				openid, todayStart).Scan(&count)
			limit = AdminDailyOCRQuota
		}

	case status.IsPaid || status.IsSponsored:
		// Paid/sponsored: daily quota
		todayStart := time.Now().Truncate(24 * time.Hour)
		if quotaType == "data" {
			err = db.Pool.QueryRow(ctx,
				`SELECT COUNT(*) FROM bp_records WHERE user_id = $1 AND created_at >= $2`,
				openid, todayStart).Scan(&count)
			limit = PaidDailyDataQuota
		} else {
			err = db.Pool.QueryRow(ctx,
				`SELECT COUNT(*) FROM ocr_logs WHERE user_id = $1 AND created_at >= $2`,
				openid, todayStart).Scan(&count)
			limit = PaidDailyOCRQuota
		}

	default:
		// Free user: data is daily, OCR is monthly
		if quotaType == "data" {
			todayStart := time.Now().Truncate(24 * time.Hour)
			err = db.Pool.QueryRow(ctx,
				`SELECT COUNT(*) FROM bp_records WHERE user_id = $1 AND created_at >= $2`,
				openid, todayStart).Scan(&count)
			limit = FreeDailyDataQuota
		} else {
			// Monthly: count from the 1st of the current month
			now := time.Now()
			monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
			err = db.Pool.QueryRow(ctx,
				`SELECT COUNT(*) FROM ocr_logs WHERE user_id = $1 AND created_at >= $2`,
				openid, monthStart).Scan(&count)
			limit = FreeMonthlyOCRQuota
		}
	}

	if err != nil {
		return false, 0, 0, fmt.Errorf("failed to count usage: %w", err)
	}

	return count < limit, count, limit, nil
}
