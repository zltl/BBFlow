package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"bbflow-server/db"
	"bbflow-server/logging"

	"github.com/gin-gonic/gin"
)

// ExportUserData exports all user data as JSON
func ExportUserData(c *gin.Context) {
	log := logging.FromGin(c)
	openid := c.GetString("openid")
	if openid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	ctx := context.Background()

	// Fetch user profile
	var nickname, avatarURL *string
	var createdAt time.Time
	var paidUntil *time.Time
	db.Pool.QueryRow(ctx,
		`SELECT nickname, avatar_url, created_at, paid_until FROM users WHERE openid = $1`,
		openid).Scan(&nickname, &avatarURL, &createdAt, &paidUntil)

	// Fetch BP records
	rows, err := db.Pool.Query(ctx,
		`SELECT id, systolic, diastolic, heart_rate, measured_at, tags, note, created_at
		 FROM bp_records WHERE user_id = $1 ORDER BY measured_at DESC`, openid)
	if err != nil {
		log.Error("failed to export records", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Export failed"})
		return
	}
	defer rows.Close()

	type record struct {
		ID         int        `json:"id"`
		Systolic   int        `json:"systolic"`
		Diastolic  int        `json:"diastolic"`
		HeartRate  *int       `json:"heart_rate"`
		MeasuredAt time.Time  `json:"measured_at"`
		Tags       string     `json:"tags"`
		Note       string     `json:"note"`
		CreatedAt  time.Time  `json:"created_at"`
	}

	var records []record
	for rows.Next() {
		var r record
		rows.Scan(&r.ID, &r.Systolic, &r.Diastolic, &r.HeartRate, &r.MeasuredAt, &r.Tags, &r.Note, &r.CreatedAt)
		records = append(records, r)
	}

	// Fetch medications
	medRows, err := db.Pool.Query(ctx,
		`SELECT id, name, dosage, frequency, is_active, created_at
		 FROM medications WHERE user_id = $1`, openid)
	if err == nil {
		defer medRows.Close()
	}

	type medication struct {
		ID        int       `json:"id"`
		Name      string    `json:"name"`
		Dosage    string    `json:"dosage"`
		Frequency string    `json:"frequency"`
		IsActive  bool      `json:"is_active"`
		CreatedAt time.Time `json:"created_at"`
	}

	var meds []medication
	if medRows != nil {
		for medRows.Next() {
			var m medication
			medRows.Scan(&m.ID, &m.Name, &m.Dosage, &m.Frequency, &m.IsActive, &m.CreatedAt)
			meds = append(meds, m)
		}
	}

	export := map[string]interface{}{
		"exported_at": time.Now().Format(time.RFC3339),
		"user": map[string]interface{}{
			"nickname":   nickname,
			"avatar_url": avatarURL,
			"created_at": createdAt,
			"paid_until": paidUntil,
		},
		"bp_records":  records,
		"medications": meds,
		"record_count": len(records),
	}

	// Log analytics event
	db.Pool.Exec(ctx,
		`INSERT INTO analytics_events (user_id, event_type) VALUES ($1, 'data_export')`, openid)

	log.Info("user data exported", "openid", openid, "records", len(records))

	c.Header("Content-Disposition", "attachment; filename=bbflow-export.json")
	c.JSON(http.StatusOK, export)
}

// ExportUserDataCSV exports BP records as CSV
func ExportUserDataCSV(c *gin.Context) {
	openid := c.GetString("openid")
	if openid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	rows, err := db.Pool.Query(context.Background(),
		`SELECT systolic, diastolic, heart_rate, measured_at, tags, note
		 FROM bp_records WHERE user_id = $1 ORDER BY measured_at DESC`, openid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Export failed"})
		return
	}
	defer rows.Close()

	csv := "日期,时间,收缩压,舒张压,心率,标签,备注\n"
	for rows.Next() {
		var systolic, diastolic int
		var heartRate *int
		var measuredAt time.Time
		var tags, note string
		rows.Scan(&systolic, &diastolic, &heartRate, &measuredAt, &tags, &note)

		hr := ""
		if heartRate != nil {
			hr = json.Number(json.Number(string(rune(*heartRate + '0')))).String()
			// Simple int to string
			hrBytes, _ := json.Marshal(heartRate)
			hr = string(hrBytes)
		}

		csv += measuredAt.Format("2006-01-02") + "," +
			measuredAt.Format("15:04") + "," +
			intToStr(systolic) + "," +
			intToStr(diastolic) + "," +
			hr + "," +
			escapeCsv(tags) + "," +
			escapeCsv(note) + "\n"
	}

	c.Header("Content-Disposition", "attachment; filename=bbflow-records.csv")
	c.Header("Content-Type", "text/csv; charset=utf-8")
	// BOM for Excel compatibility
	c.String(http.StatusOK, "\xEF\xBB\xBF"+csv)
}

func intToStr(v int) string {
	b, _ := json.Marshal(v)
	return string(b)
}

func escapeCsv(s string) string {
	// Wrap in quotes if contains comma or newline
	for _, c := range s {
		if c == ',' || c == '\n' || c == '"' {
			return "\"" + s + "\""
		}
	}
	return s
}

// DeleteAccount deletes all user data and the user account
func DeleteAccount(c *gin.Context) {
	log := logging.FromGin(c)
	openid := c.GetString("openid")
	if openid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	ctx := context.Background()
	tx, err := db.Pool.Begin(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to start transaction"})
		return
	}
	defer tx.Rollback(ctx)

	// Delete in dependency order
	tables := []struct {
		query string
		args  []interface{}
	}{
		{`DELETE FROM medication_logs WHERE user_id = $1`, []interface{}{openid}},
		{`DELETE FROM medications WHERE user_id = $1`, []interface{}{openid}},
		{`DELETE FROM ticket_messages WHERE ticket_id IN (SELECT id FROM support_tickets WHERE user_id = $1)`, []interface{}{openid}},
		{`DELETE FROM support_tickets WHERE user_id = $1`, []interface{}{openid}},
		{`DELETE FROM share_access_logs WHERE token IN (SELECT token FROM share_tokens WHERE user_id = $1)`, []interface{}{openid}},
		{`DELETE FROM share_tokens WHERE user_id = $1`, []interface{}{openid}},
		{`DELETE FROM ocr_logs WHERE user_id = $1`, []interface{}{openid}},
		{`DELETE FROM bp_records WHERE user_id = $1`, []interface{}{openid}},
		{`DELETE FROM feedbacks WHERE user_id = $1`, []interface{}{openid}},
		{`DELETE FROM invite_links WHERE creator_id = $1`, []interface{}{openid}},
		{`DELETE FROM data_exports WHERE user_id = $1`, []interface{}{openid}},
		{`DELETE FROM analytics_events WHERE user_id = $1`, []interface{}{openid}},
		{`DELETE FROM users WHERE openid = $1`, []interface{}{openid}},
	}

	for _, t := range tables {
		if _, err := tx.Exec(ctx, t.query, t.args...); err != nil {
			log.Error("failed to delete user data", "table", t.query, "error", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete account"})
			return
		}
	}

	if err := tx.Commit(ctx); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to commit deletion"})
		return
	}

	log.Info("account deleted", "openid", openid)
	c.JSON(http.StatusOK, gin.H{"message": "账号已删除，所有数据已清除"})
}
