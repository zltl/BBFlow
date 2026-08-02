package reminder

import (
	"context"
	"log/slog"
	"time"

	"bbflow-server/config"
	"bbflow-server/db"
	"bbflow-server/utils"
)

// StartScheduler runs a background loop that sends medication / measure reminders.
func StartScheduler(ctx context.Context) {
	ticker := time.NewTicker(60 * time.Second)
	go func() {
		defer ticker.Stop()
		runOnce()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				runOnce()
			}
		}
	}()
	slog.Info("reminder scheduler started")
}

func runOnce() {
	templateID := config.AppConfig.SubscribeMedTemplateID
	if templateID == "" {
		return
	}
	now := time.Now()
	minuteKey := now.Format("15:04")
	today := now.Format("2006-01-02")

	dispatchMedReminders(templateID, today, minuteKey)
	dispatchMeasureReminders(templateID, today, minuteKey)
}

func medKey(medID *int) int {
	if medID == nil {
		return 0
	}
	return *medID
}

func alreadyDispatched(userID string, medID *int, reminderType, today, minuteKey string) bool {
	var exists bool
	err := db.Pool.QueryRow(context.Background(), `
SELECT EXISTS(
  SELECT 1 FROM reminder_dispatches
  WHERE user_id = $1
    AND reminder_type = $2
    AND dispatch_date = $3::date
    AND dispatch_minute = $4
    AND COALESCE(medication_id, 0) = $5
)
`, userID, reminderType, today, minuteKey, medKey(medID)).Scan(&exists)
	return err == nil && exists
}

func markDispatched(userID string, medID *int, reminderType, today, minuteKey string) {
	_, _ = db.Pool.Exec(context.Background(), `
INSERT INTO reminder_dispatches (user_id, medication_id, reminder_type, dispatch_date, dispatch_minute)
VALUES ($1, $2, $3, $4::date, $5)
ON CONFLICT DO NOTHING
`, userID, medKey(medID), reminderType, today, minuteKey)
}

func dispatchMedReminders(templateID, today, minuteKey string) {
	rows, err := db.Pool.Query(context.Background(), `
SELECT m.id, m.user_id, m.name, m.dosage, COALESCE(m.reminder_time, '')
FROM medications m
JOIN reminder_prefs p ON p.user_id = m.user_id
WHERE m.is_active = true
  AND p.med_reminders_enabled = true
  AND COALESCE(m.reminder_time, '') = $1
`, minuteKey)
	if err != nil {
		slog.Error("med reminder query failed", "error", err)
		return
	}
	defer rows.Close()

	for rows.Next() {
		var medID int
		var userID, name, dosage, reminderTime string
		if err := rows.Scan(&medID, &userID, &name, &dosage, &reminderTime); err != nil {
			continue
		}
		if alreadyDispatched(userID, &medID, "medication", today, minuteKey) {
			continue
		}
		thing11 := name
		if len([]rune(thing11)) > 20 {
			thing11 = string([]rune(thing11)[:20])
		}
		timeStr := today + " " + reminderTime
		data := map[string]map[string]string{
			"thing1":  {"value": thing11},
			"time2":   {"value": timeStr},
			"thing3":  {"value": truncate("请按时服药并打卡", 20)},
		}
		if dosage != "" {
			data["thing3"] = map[string]string{"value": truncate("剂量 "+dosage+"，请打卡", 20)}
		}
		if err := utils.SendSubscribeMessage(userID, templateID, "pages/medications/index", data); err != nil {
			slog.Warn("med reminder send failed", "user", userID, "med", medID, "error", err)
			continue
		}
		markDispatched(userID, &medID, "medication", today, minuteKey)
		slog.Info("med reminder sent", "user", userID, "medication_id", medID)
	}
}

func dispatchMeasureReminders(templateID, today, minuteKey string) {
	rows, err := db.Pool.Query(context.Background(), `
SELECT user_id, COALESCE(measure_reminder_time, '08:00')
FROM reminder_prefs
WHERE measure_reminders_enabled = true
  AND COALESCE(measure_reminder_time, '08:00') = $1
`, minuteKey)
	if err != nil {
		slog.Error("measure reminder query failed", "error", err)
		return
	}
	defer rows.Close()

	for rows.Next() {
		var userID, reminderTime string
		if err := rows.Scan(&userID, &reminderTime); err != nil {
			continue
		}
		if alreadyDispatched(userID, nil, "measure", today, minuteKey) {
			continue
		}
		data := map[string]map[string]string{
			"thing1": {"value": "血压测量提醒"},
			"time2":  {"value": today + " " + reminderTime},
			"thing3": {"value": "请安静休息后测量并记录"},
		}
		if err := utils.SendSubscribeMessage(userID, templateID, "pages/record/record", data); err != nil {
			slog.Warn("measure reminder send failed", "user", userID, "error", err)
			continue
		}
		markDispatched(userID, nil, "measure", today, minuteKey)
		slog.Info("measure reminder sent", "user", userID)
	}
}

func truncate(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max])
}
