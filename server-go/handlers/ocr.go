package handlers

import (
	"context"
	"encoding/json"
	"io"
	"net/http"

	"bbflow-server/db"
	"bbflow-server/logging"
	"bbflow-server/utils"

	"github.com/gin-gonic/gin"
)

var ocrQueue = utils.NewRateLimitedQueue(10)

func OCRRecognize(c *gin.Context) {
	log := logging.FromGin(c)
	openid := c.GetString("openid")
	if openid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "Unauthorized"})
		return
	}

	// Check OCR quota
	allowed, used, limit, err := checkQuota(context.Background(), openid, "ocr")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "Failed to check quota"})
		return
	}
	if !allowed {
		log.Warn("ocr quota exceeded", "openid", openid, "used", used, "limit", limit)
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "已达到OCR识别次数上限", "used": used, "limit": limit})
		return
	}

	file, header, err := c.Request.FormFile("image")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "No image file provided"})
		return
	}
	defer file.Close()

	log.Info("ocr process started", "filename", header.Filename, "size", header.Size)

	imageData, err := io.ReadAll(file)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "Failed to read image"})
		return
	}

	// Upload to OSS
	ossPath, err := utils.UploadImageToOSS(imageData, header.Filename)
	if err != nil {
		log.Error("oss upload failed", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "Failed to upload image"})
		return
	}
	log.Info("image uploaded to oss", "path", ossPath)

	// Call Baidu OCR
	wordsResult, err := utils.RecognizeImage(imageData)
	if err != nil {
		log.Error("baidu ocr failed", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "OCR recognition failed"})
		return
	}
	log.Info("ocr recognition complete", "words_count", len(wordsResult))

	// Parse BP data
	bpData := utils.ParseBPData(wordsResult)
	log.Info("bp data parsed", "systolic", bpData.Systolic, "diastolic", bpData.Diastolic, "heartrate", bpData.HeartRate)

	// Save log to DB
	wordsResultJSON, _ := json.Marshal(wordsResult)
	bpDataJSON, _ := json.Marshal(bpData)

	verificationStatus := "auto_accepted"
	if bpData.Confidence < 0.7 {
		verificationStatus = "needs_review"
	}

	var ocrLogID int
	err = db.Pool.QueryRow(context.Background(),
		`INSERT INTO ocr_logs (user_id, image_path, raw_result, parsed_result, status, confidence_score, extraction_strategy, verification_status)
		 VALUES ($1, $2, $3, $4, 'completed', $5, $6, $7) RETURNING id`,
		openid, ossPath, string(wordsResultJSON), string(bpDataJSON),
		bpData.Confidence, bpData.ExtractionStrategy, verificationStatus).Scan(&ocrLogID)
	if err != nil {
		log.Error("failed to save ocr log", "error", err)
	}

	c.JSON(http.StatusOK, gin.H{
		"success":            true,
		"data":               bpData,
		"ocrLogId":           ocrLogID,
		"confidence":         bpData.Confidence,
		"needsReview":        bpData.Confidence < 0.7,
		"extractionStrategy": bpData.ExtractionStrategy,
	})
}
