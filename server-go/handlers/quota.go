package handlers

import (
	"context"
	"fmt"
	"time"

	"bbflow-server/db"
)

const (
	// Free user limits (total, lifetime)
	FreeDataQuota = 30
	FreeOCRQuota  = 5

	// Paid/sponsored user limits (per day)
	PaidDailyDataQuota = 30
	PaidDailyOCRQuota  = 60
)

// Keep legacy constant name for backward compat where referenced
const DefaultDataQuota = FreeDataQuota
const DefaultOCRQuota = FreeOCRQuota

// UserPaidStatus represents the paid status of a user
type UserPaidStatus struct {
	IsPaid      bool       // directly paid (paid_until > now)
	IsSponsored bool       // invited by a paid user whose paid_until > now
	PaidUntil   *time.Time // the user's own paid_until
	SponsorID   *string    // who sponsored this user
}

// getUserPaidStatus determines if the user is paid, sponsored, or free
func getUserPaidStatus(ctx context.Context, openid string) (*UserPaidStatus, error) {
	var paidUntil *time.Time
	var sponsorID *string

	err := db.Pool.QueryRow(ctx, `
		SELECT paid_until, sponsor_id FROM users WHERE openid = $1
	`, openid).Scan(&paidUntil, &sponsorID)
	if err != nil {
		return nil, fmt.Errorf("failed to get user status: %w", err)
	}

	status := &UserPaidStatus{
		PaidUntil: paidUntil,
		SponsorID: sponsorID,
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
// For free users: total count across all time.
// For paid/sponsored users: count for today only.
// Returns (allowed, used, limit, error)
func checkQuota(ctx context.Context, openid string, quotaType string) (bool, int, int, error) {
	status, err := getUserPaidStatus(ctx, openid)
	if err != nil {
		return false, 0, 0, err
	}

	isPaidOrSponsored := status.IsPaid || status.IsSponsored

	var count int
	if isPaidOrSponsored {
		// Paid/sponsored: count today's usage only
		todayStart := time.Now().Truncate(24 * time.Hour)
		if quotaType == "data" {
			err = db.Pool.QueryRow(ctx,
				`SELECT COUNT(*) FROM bp_records WHERE user_id = $1 AND created_at >= $2`,
				openid, todayStart).Scan(&count)
		} else {
			err = db.Pool.QueryRow(ctx,
				`SELECT COUNT(*) FROM ocr_logs WHERE user_id = $1 AND created_at >= $2`,
				openid, todayStart).Scan(&count)
		}
	} else {
		// Free user: count total usage
		if quotaType == "data" {
			err = db.Pool.QueryRow(ctx,
				`SELECT COUNT(*) FROM bp_records WHERE user_id = $1`,
				openid).Scan(&count)
		} else {
			err = db.Pool.QueryRow(ctx,
				`SELECT COUNT(*) FROM ocr_logs WHERE user_id = $1`,
				openid).Scan(&count)
		}
	}

	if err != nil {
		return false, 0, 0, fmt.Errorf("failed to count usage: %w", err)
	}

	var limit int
	if isPaidOrSponsored {
		if quotaType == "data" {
			limit = PaidDailyDataQuota
		} else {
			limit = PaidDailyOCRQuota
		}
	} else {
		if quotaType == "data" {
			limit = FreeDataQuota
		} else {
			limit = FreeOCRQuota
		}
	}

	return count < limit, count, limit, nil
}
