package handlers

import (
	"context"
	"net/http"

	"bbflow-server/config"
	"bbflow-server/db"
	"bbflow-server/logging"

	"github.com/gin-gonic/gin"
)

type ReminderPrefsResponse struct {
	MedRemindersEnabled     bool   `json:"med_reminders_enabled"`
	MeasureRemindersEnabled bool   `json:"measure_reminders_enabled"`
	MeasureReminderTime     string `json:"measure_reminder_time"`
	TemplateID              string `json:"template_id"`
}

func GetReminderPrefs(c *gin.Context) {
	openid := c.GetString("openid")
	ctx := context.Background()

	var medEnabled, measureEnabled bool
	var measureTime string
	err := db.Pool.QueryRow(ctx, `
SELECT COALESCE(med_reminders_enabled, false), COALESCE(measure_reminders_enabled, false),
       COALESCE(measure_reminder_time, '08:00')
FROM reminder_prefs WHERE user_id = $1
`, openid).Scan(&medEnabled, &measureEnabled, &measureTime)
	if err != nil {
		c.JSON(http.StatusOK, ReminderPrefsResponse{
			MedRemindersEnabled:     false,
			MeasureRemindersEnabled: false,
			MeasureReminderTime:     "08:00",
			TemplateID:              config.AppConfig.SubscribeMedTemplateID,
		})
		return
	}

	c.JSON(http.StatusOK, ReminderPrefsResponse{
		MedRemindersEnabled:     medEnabled,
		MeasureRemindersEnabled: measureEnabled,
		MeasureReminderTime:     measureTime,
		TemplateID:              config.AppConfig.SubscribeMedTemplateID,
	})
}

func UpdateReminderPrefs(c *gin.Context) {
	openid := c.GetString("openid")
	logger := logging.FromGin(c)

	var req struct {
		MedRemindersEnabled     *bool  `json:"med_reminders_enabled"`
		MeasureRemindersEnabled *bool  `json:"measure_reminders_enabled"`
		MeasureReminderTime     string `json:"measure_reminder_time"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}

	medEnabled := false
	measureEnabled := false
	measureTime := "08:00"
	_ = db.Pool.QueryRow(context.Background(), `
SELECT COALESCE(med_reminders_enabled, false), COALESCE(measure_reminders_enabled, false),
       COALESCE(measure_reminder_time, '08:00') FROM reminder_prefs WHERE user_id = $1
`, openid).Scan(&medEnabled, &measureEnabled, &measureTime)

	if req.MedRemindersEnabled != nil {
		medEnabled = *req.MedRemindersEnabled
	}
	if req.MeasureRemindersEnabled != nil {
		measureEnabled = *req.MeasureRemindersEnabled
	}
	if req.MeasureReminderTime != "" {
		measureTime = req.MeasureReminderTime
	}

	_, err := db.Pool.Exec(context.Background(), `
INSERT INTO reminder_prefs (user_id, med_reminders_enabled, measure_reminders_enabled, measure_reminder_time, updated_at)
VALUES ($1, $2, $3, $4, NOW())
ON CONFLICT (user_id) DO UPDATE SET
  med_reminders_enabled = EXCLUDED.med_reminders_enabled,
  measure_reminders_enabled = EXCLUDED.measure_reminders_enabled,
  measure_reminder_time = EXCLUDED.measure_reminder_time,
  updated_at = NOW()
`, openid, medEnabled, measureEnabled, measureTime)
	if err != nil {
		logger.Error("failed to update reminder prefs", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "保存失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"med_reminders_enabled":     medEnabled,
		"measure_reminders_enabled": measureEnabled,
		"measure_reminder_time":     measureTime,
		"template_id":               config.AppConfig.SubscribeMedTemplateID,
	})
}
