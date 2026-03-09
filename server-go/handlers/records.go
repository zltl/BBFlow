package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"bbflow-server/db"

	"github.com/gin-gonic/gin"
)

type BPRecord struct {
	ID         int        `json:"id"`
	UserID     string     `json:"user_id"`
	Systolic   int        `json:"systolic"`
	Diastolic  int        `json:"diastolic"`
	HeartRate  *int       `json:"heart_rate"`
	MeasuredAt time.Time  `json:"measured_at"`
	Tags       string     `json:"tags"`
	Note       string     `json:"note"`
	CreatedAt  time.Time  `json:"created_at"`
}

type CreateRecordRequest struct {
	Systolic   int      `json:"systolic" binding:"required"`
	Diastolic  int      `json:"diastolic" binding:"required"`
	HeartRate  *int     `json:"heartRate"`
	MeasuredAt *string  `json:"measuredAt"`
	Tags       []string `json:"tags"`
	Note       string   `json:"note"`
	OCRLogID   *int     `json:"ocrLogId"`
}

func GetRecords(c *gin.Context) {
	openid := c.GetString("openid")
	if openid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	rows, err := db.Pool.Query(context.Background(),
		`SELECT id, user_id, systolic, diastolic, heart_rate, measured_at, COALESCE(tags, ''), COALESCE(note, ''), created_at 
		 FROM bp_records WHERE user_id = $1 ORDER BY measured_at DESC`, openid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Database query error: " + err.Error()})
		return
	}
	defer rows.Close()

	var records []BPRecord
	for rows.Next() {
		var r BPRecord
		if err := rows.Scan(&r.ID, &r.UserID, &r.Systolic, &r.Diastolic, &r.HeartRate,
			&r.MeasuredAt, &r.Tags, &r.Note, &r.CreatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Scan error: " + err.Error()})
			return
		}
		records = append(records, r)
	}

	c.JSON(http.StatusOK, gin.H{"data": records})
}

func CreateRecord(c *gin.Context) {
	openid := c.GetString("openid")
	if openid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	var req CreateRecordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Missing required fields"})
		return
	}

	// Validate blood pressure ranges
	if req.Systolic < 60 || req.Systolic > 300 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "收缩压范围应在 60-300 mmHg"})
		return
	}
	if req.Diastolic < 30 || req.Diastolic > 200 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "舒张压范围应在 30-200 mmHg"})
		return
	}
	if req.Systolic <= req.Diastolic {
		c.JSON(http.StatusBadRequest, gin.H{"error": "收缩压应大于舒张压"})
		return
	}
	if req.HeartRate != nil && (*req.HeartRate < 20 || *req.HeartRate > 300) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "心率范围应在 20-300 bpm"})
		return
	}

	measuredAt := time.Now()
	if req.MeasuredAt != nil {
		if t, err := time.Parse(time.RFC3339, *req.MeasuredAt); err == nil {
			measuredAt = t
		}
	}

	tagsJSON, _ := json.Marshal(req.Tags)

	ctx := context.Background()
	tx, err := db.Pool.Begin(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer tx.Rollback(ctx)

	// Check quota inside the transaction to avoid TOCTOU race
	allowed, used, limit, err := checkQuota(ctx, openid, "data")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to check quota"})
		return
	}
	if !allowed {
		c.JSON(http.StatusForbidden, gin.H{"error": "已达到数据条数上限", "used": used, "limit": limit})
		return
	}

	var recordID int
	err = tx.QueryRow(ctx,
		`INSERT INTO bp_records (user_id, systolic, diastolic, heart_rate, measured_at, tags, note) 
		 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
		openid, req.Systolic, req.Diastolic, req.HeartRate, measuredAt, string(tagsJSON), req.Note).Scan(&recordID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if req.OCRLogID != nil {
		finalResult, _ := json.Marshal(map[string]interface{}{
			"systolic":  req.Systolic,
			"diastolic": req.Diastolic,
			"heartRate": req.HeartRate,
		})
		_, err = tx.Exec(ctx,
			`UPDATE ocr_logs SET record_id = $1, final_result = $2 WHERE id = $3`,
			recordID, string(finalResult), *req.OCRLogID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}

	if err := tx.Commit(ctx); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Log analytics event
	db.Pool.Exec(ctx,
		`INSERT INTO analytics_events (user_id, event_type) VALUES ($1, 'create_record')`, openid)

	c.JSON(http.StatusOK, gin.H{"id": recordID, "message": "Record saved successfully"})
}

func DeleteRecord(c *gin.Context) {
	openid := c.GetString("openid")
	if openid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID"})
		return
	}

	result, err := db.Pool.Exec(context.Background(),
		`DELETE FROM bp_records WHERE id = $1 AND user_id = $2`, id, openid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if result.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Record not found or permission denied"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Record deleted"})
}
