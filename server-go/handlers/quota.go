package handlers

import (
	"context"
	"encoding/json"
	"fmt"

	"bbflow-server/db"
)

const (
	DefaultDataQuota = 14
	DefaultOCRQuota  = 5
)

type RateLimitConfig struct {
	Authorized bool `json:"authorized"`
	DataQuota  int  `json:"data_quota"`
	OCRQuota   int  `json:"ocr_quota"`
}

func checkQuota(ctx context.Context, openid string, quotaType string) (bool, int, int, error) {
	// 1. Get user config
	var rlConfig sqlNullString
	err := db.Pool.QueryRow(ctx, `SELECT rate_limit_config FROM users WHERE openid = $1`, openid).Scan(&rlConfig)
	if err != nil {
		return false, 0, 0, fmt.Errorf("failed to get user config: %w", err)
	}

	limit := 0
	if quotaType == "data" {
		limit = DefaultDataQuota
	} else {
		limit = DefaultOCRQuota
	}

	if rlConfig.Valid && rlConfig.String != "" {
		var cfg RateLimitConfig
		if err := json.Unmarshal([]byte(rlConfig.String), &cfg); err == nil {
			if quotaType == "data" && cfg.DataQuota > 0 {
				limit = cfg.DataQuota
			} else if quotaType == "ocr" && cfg.OCRQuota > 0 {
				limit = cfg.OCRQuota
			}
		}
	}

	// 2. Count usage
	var count int
	if quotaType == "data" {
		err = db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM bp_records WHERE user_id = $1`, openid).Scan(&count)
	} else {
		err = db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM ocr_logs WHERE user_id = $1`, openid).Scan(&count)
	}

	if err != nil {
		return false, 0, 0, fmt.Errorf("failed to count usage: %w", err)
	}

	return count < limit, count, limit, nil
}
