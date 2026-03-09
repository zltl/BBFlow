package handlers

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"bbflow-server/db"
	"bbflow-server/logging"

	"github.com/gin-gonic/gin"
)

type MedicationRequest struct {
	Name         string `json:"name" binding:"required"`
	Dosage       string `json:"dosage"`
	Frequency    string `json:"frequency"`
	ReminderTime string `json:"reminderTime"`
}

type MedicationLogRequest struct {
	MedicationID int    `json:"medicationId" binding:"required"`
	Skipped      bool   `json:"skipped"`
	Note         string `json:"note"`
}

// ListMedications returns all medications for the user
func ListMedications(c *gin.Context) {
	openid := c.GetString("openid")
	if openid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	rows, err := db.Pool.Query(context.Background(),
		`SELECT id, name, dosage, frequency, reminder_time, is_active, created_at
		 FROM medications WHERE user_id = $1 ORDER BY created_at DESC`, openid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to query medications"})
		return
	}
	defer rows.Close()

	type med struct {
		ID           int       `json:"id"`
		Name         string    `json:"name"`
		Dosage       string    `json:"dosage"`
		Frequency    string    `json:"frequency"`
		ReminderTime string    `json:"reminder_time"`
		IsActive     bool      `json:"is_active"`
		CreatedAt    time.Time `json:"created_at"`
	}

	var meds []med
	for rows.Next() {
		var m med
		rows.Scan(&m.ID, &m.Name, &m.Dosage, &m.Frequency, &m.ReminderTime, &m.IsActive, &m.CreatedAt)
		meds = append(meds, m)
	}

	c.JSON(http.StatusOK, gin.H{"data": meds})
}

// CreateMedication adds a new medication
func CreateMedication(c *gin.Context) {
	log := logging.FromGin(c)
	openid := c.GetString("openid")
	if openid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	var req MedicationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	var id int
	err := db.Pool.QueryRow(context.Background(),
		`INSERT INTO medications (user_id, name, dosage, frequency, reminder_time)
		 VALUES ($1, $2, $3, $4, $5) RETURNING id`,
		openid, req.Name, req.Dosage, req.Frequency, req.ReminderTime).Scan(&id)
	if err != nil {
		log.Error("failed to create medication", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create medication"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"id": id, "message": "药物添加成功"})
}

// UpdateMedication updates an existing medication
func UpdateMedication(c *gin.Context) {
	openid := c.GetString("openid")
	if openid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID"})
		return
	}

	var req MedicationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	result, err := db.Pool.Exec(context.Background(),
		`UPDATE medications SET name=$1, dosage=$2, frequency=$3, reminder_time=$4, updated_at=$5
		 WHERE id=$6 AND user_id=$7`,
		req.Name, req.Dosage, req.Frequency, req.ReminderTime, time.Now(), id, openid)
	if err != nil || result.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Medication not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "更新成功"})
}

// DeleteMedication deactivates a medication
func DeleteMedication(c *gin.Context) {
	openid := c.GetString("openid")
	if openid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID"})
		return
	}

	result, err := db.Pool.Exec(context.Background(),
		`UPDATE medications SET is_active = FALSE, updated_at = $1 WHERE id = $2 AND user_id = $3`,
		time.Now(), id, openid)
	if err != nil || result.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Medication not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "已停用"})
}

// LogMedication records a medication intake or skip
func LogMedication(c *gin.Context) {
	log := logging.FromGin(c)
	openid := c.GetString("openid")
	if openid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	var req MedicationLogRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	// Verify ownership
	var medUser string
	err := db.Pool.QueryRow(context.Background(),
		`SELECT user_id FROM medications WHERE id = $1`, req.MedicationID).Scan(&medUser)
	if err != nil || medUser != openid {
		c.JSON(http.StatusForbidden, gin.H{"error": "Not authorized"})
		return
	}

	var id int
	err = db.Pool.QueryRow(context.Background(),
		`INSERT INTO medication_logs (medication_id, user_id, skipped, note)
		 VALUES ($1, $2, $3, $4) RETURNING id`,
		req.MedicationID, openid, req.Skipped, req.Note).Scan(&id)
	if err != nil {
		log.Error("failed to log medication", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to log"})
		return
	}

	action := "服药打卡成功"
	if req.Skipped {
		action = "已记录跳过"
	}
	c.JSON(http.StatusOK, gin.H{"id": id, "message": action})
}

// GetMedicationAdherence returns adherence statistics
func GetMedicationAdherence(c *gin.Context) {
	openid := c.GetString("openid")
	if openid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	days := 30
	if d := c.Query("days"); d != "" {
		if v, err := strconv.Atoi(d); err == nil && v > 0 {
			days = v
		}
	}

	since := time.Now().AddDate(0, 0, -days)
	ctx := context.Background()

	rows, err := db.Pool.Query(ctx,
		`SELECT m.id, m.name,
		        COUNT(ml.id) FILTER (WHERE NOT ml.skipped) as taken_count,
		        COUNT(ml.id) FILTER (WHERE ml.skipped) as skipped_count,
		        COUNT(ml.id) as total_logs
		 FROM medications m
		 LEFT JOIN medication_logs ml ON ml.medication_id = m.id AND ml.taken_at >= $2
		 WHERE m.user_id = $1 AND m.is_active = TRUE
		 GROUP BY m.id, m.name
		 ORDER BY m.name`, openid, since)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to query adherence"})
		return
	}
	defer rows.Close()

	type adherence struct {
		MedicationID int     `json:"medication_id"`
		Name         string  `json:"name"`
		TakenCount   int     `json:"taken_count"`
		SkippedCount int     `json:"skipped_count"`
		TotalLogs    int     `json:"total_logs"`
		Rate         float64 `json:"adherence_rate"`
	}

	var results []adherence
	for rows.Next() {
		var a adherence
		rows.Scan(&a.MedicationID, &a.Name, &a.TakenCount, &a.SkippedCount, &a.TotalLogs)
		if a.TotalLogs > 0 {
			a.Rate = float64(a.TakenCount) / float64(a.TotalLogs) * 100
		}
		results = append(results, a)
	}

	c.JSON(http.StatusOK, gin.H{"data": results, "period_days": days})
}
