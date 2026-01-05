package handlers

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"

	"bbflow-server/db"
	"bbflow-server/utils"

	"github.com/gin-gonic/gin"
)

var ocrQueue = utils.NewRateLimitedQueue(10)

func OCRRecognize(c *gin.Context) {
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
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "已达到OCR识别次数上限", "used": used, "limit": limit})
		return
	}

	file, header, err := c.Request.FormFile("image")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "No image file provided"})
		return
	}
	defer file.Close()

	log.Printf("[OCR] Starting OCR process for file: %s, size: %d bytes", header.Filename, header.Size)

	imageData, err := io.ReadAll(file)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "Failed to read image"})
		return
	}

	// Upload to OSS
	log.Println("[OCR] Uploading image to OSS...")
	ossPath, err := utils.UploadImageToOSS(imageData, header.Filename)
	if err != nil {
		log.Println("[OCR] OSS upload error:", err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "Failed to upload image"})
		return
	}
	log.Printf("[OCR] Image uploaded to OSS: %s", ossPath)

	// Call Baidu OCR
	log.Println("[OCR] Calling Baidu OCR API...")
	wordsResult, err := utils.RecognizeImage(imageData)
	if err != nil {
		log.Println("[OCR] Baidu OCR error:", err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "OCR recognition failed"})
		return
	}
	log.Printf("[OCR] Baidu OCR Success. Found %d words.", len(wordsResult))

	// Parse BP data
	log.Println("[OCR] Parsing OCR data...")
	bpData := utils.ParseBPData(wordsResult)
	log.Printf("[OCR] Parsed BP Data: %+v", bpData)

	// Save log to DB
	wordsResultJSON, _ := json.Marshal(wordsResult)
	bpDataJSON, _ := json.Marshal(bpData)

	var ocrLogID int
	err = db.Pool.QueryRow(context.Background(),
		`INSERT INTO ocr_logs (image_path, ocr_raw_json, parsed_result)
		 VALUES ($1, $2, $3) RETURNING id`,
		ossPath, string(wordsResultJSON), string(bpDataJSON)).Scan(&ocrLogID)
	if err != nil {
		log.Println("[OCR] DB error:", err)
	}

	c.JSON(http.StatusOK, gin.H{
		"success":  true,
		"data":     bpData,
		"ocrLogId": ocrLogID,
	})
}
