package handlers

import (
	"context"
	"encoding/json"
	"net/http"

	"bbflow-server/db"
	"bbflow-server/logging"

	"github.com/gin-gonic/gin"
)

type OCRVerifyRequest struct {
	OCRLogID  int  `json:"ocrLogId" binding:"required"`
	Systolic  *int `json:"systolic"`
	Diastolic *int `json:"diastolic"`
	HeartRate *int `json:"heartRate"`
	Accepted  bool `json:"accepted"`
}

// OCRVerify allows users to confirm or correct OCR results
func OCRVerify(c *gin.Context) {
	log := logging.FromGin(c)
	openid := c.GetString("openid")
	if openid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "Unauthorized"})
		return
	}

	var req OCRVerifyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid request"})
		return
	}

	ctx := context.Background()

	// Verify ownership
	var logUserID string
	err := db.Pool.QueryRow(ctx,
		`SELECT user_id FROM ocr_logs WHERE id = $1`, req.OCRLogID).Scan(&logUserID)
	if err != nil || logUserID != openid {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "Not authorized to verify this OCR log"})
		return
	}

	if req.Accepted {
		_, err = db.Pool.Exec(ctx,
			`UPDATE ocr_logs SET verification_status = 'confirmed' WHERE id = $1`, req.OCRLogID)
	} else {
		corrected, _ := json.Marshal(map[string]interface{}{
			"systolic":  req.Systolic,
			"diastolic": req.Diastolic,
			"heartRate": req.HeartRate,
		})
		_, err = db.Pool.Exec(ctx,
			`UPDATE ocr_logs SET verification_status = 'corrected', user_corrected_values = $1 WHERE id = $2`,
			string(corrected), req.OCRLogID)
	}

	if err != nil {
		log.Error("failed to update ocr verification", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "Failed to update verification"})
		return
	}

	log.Info("ocr verification updated", "ocr_log_id", req.OCRLogID, "accepted", req.Accepted)
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "Verification updated"})
}
