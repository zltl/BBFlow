package handlers

import (
	"context"
	"math"
	"net/http"
	"time"

	"bbflow-server/db"
	"bbflow-server/logging"

	"github.com/gin-gonic/gin"
)

type Insight struct {
	Type    string `json:"type"`
	Level   string `json:"level"`
	Title   string `json:"title"`
	Message string `json:"message"`
}

type InsightsResponse struct {
	Period        string    `json:"period"`
	RecordCount   int       `json:"record_count"`
	AvgSystolic   float64   `json:"avg_systolic"`
	AvgDiastolic  float64   `json:"avg_diastolic"`
	AvgHeartRate  float64   `json:"avg_heart_rate"`
	MaxSystolic   int       `json:"max_systolic"`
	MinSystolic   int       `json:"min_systolic"`
	MaxDiastolic  int       `json:"max_diastolic"`
	MinDiastolic  int       `json:"min_diastolic"`
	Insights      []Insight `json:"insights"`
	MorningAvgSys float64   `json:"morning_avg_sys"`
	EveningAvgSys float64   `json:"evening_avg_sys"`
}

// GetHealthInsights returns rule-based health insights for the user
func GetHealthInsights(c *gin.Context) {
	log := logging.FromGin(c)
	openid := c.GetString("openid")
	if openid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	days := 30
	if d := c.Query("days"); d != "" {
		if v := parseInt(d); v > 0 && v <= 365 {
			days = v
		}
	}

	ctx := context.Background()
	since := time.Now().AddDate(0, 0, -days)

	// Fetch records for the period
	rows, err := db.Pool.Query(ctx,
		`SELECT systolic, diastolic, heart_rate, measured_at
		 FROM bp_records WHERE user_id = $1 AND measured_at >= $2
		 ORDER BY measured_at ASC`, openid, since)
	if err != nil {
		log.Error("failed to query records for insights", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate insights"})
		return
	}
	defer rows.Close()

	type measurement struct {
		Systolic   int
		Diastolic  int
		HeartRate  *int
		MeasuredAt time.Time
	}

	var records []measurement
	for rows.Next() {
		var m measurement
		rows.Scan(&m.Systolic, &m.Diastolic, &m.HeartRate, &m.MeasuredAt)
		records = append(records, m)
	}

	if len(records) == 0 {
		c.JSON(http.StatusOK, InsightsResponse{
			Period:      formatPeriod(days),
			RecordCount: 0,
			Insights: []Insight{{
				Type:    "info",
				Level:   "info",
				Title:   "数据不足",
				Message: "该时段暂无血压记录，请坚持每日测量以获取健康洞察。",
			}},
		})
		return
	}

	// Compute statistics
	var sumSys, sumDia, sumHR float64
	var hrCount int
	maxSys, minSys := 0, 999
	maxDia, minDia := 0, 999
	var morningSys, morningCount, eveningSys, eveningCount float64
	consecutiveHigh := 0
	maxConsecutiveHigh := 0

	for _, r := range records {
		sumSys += float64(r.Systolic)
		sumDia += float64(r.Diastolic)
		if r.HeartRate != nil {
			sumHR += float64(*r.HeartRate)
			hrCount++
		}
		if r.Systolic > maxSys {
			maxSys = r.Systolic
		}
		if r.Systolic < minSys {
			minSys = r.Systolic
		}
		if r.Diastolic > maxDia {
			maxDia = r.Diastolic
		}
		if r.Diastolic < minDia {
			minDia = r.Diastolic
		}

		h := r.MeasuredAt.Hour()
		if h >= 5 && h < 11 {
			morningSys += float64(r.Systolic)
			morningCount++
		} else if h >= 18 && h < 23 {
			eveningSys += float64(r.Systolic)
			eveningCount++
		}

		if r.Systolic >= 140 || r.Diastolic >= 90 {
			consecutiveHigh++
			if consecutiveHigh > maxConsecutiveHigh {
				maxConsecutiveHigh = consecutiveHigh
			}
		} else {
			consecutiveHigh = 0
		}
	}

	n := float64(len(records))
	avgSys := sumSys / n
	avgDia := sumDia / n
	avgHR := 0.0
	if hrCount > 0 {
		avgHR = sumHR / float64(hrCount)
	}

	morningAvgSys := 0.0
	if morningCount > 0 {
		morningAvgSys = morningSys / morningCount
	}
	eveningAvgSys := 0.0
	if eveningCount > 0 {
		eveningAvgSys = eveningSys / eveningCount
	}

	// Generate insights
	var insights []Insight

	// 1. Average level classification
	if avgSys >= 180 || avgDia >= 110 {
		insights = append(insights, Insight{
			Type:    "risk",
			Level:   "critical",
			Title:   "平均值达三级高血压水平",
			Message: "您的平均血压显著偏高，建议尽快就医并遵医嘱调整治疗方案。本提示仅供参考，不构成医疗诊断。",
		})
	} else if avgSys >= 140 || avgDia >= 90 {
		insights = append(insights, Insight{
			Type:    "risk",
			Level:   "warning",
			Title:   "平均值偏高",
			Message: "您的平均血压处于高血压区间，建议关注生活方式调整并考虑咨询医生。",
		})
	} else if avgSys < 120 && avgDia < 80 {
		insights = append(insights, Insight{
			Type:    "positive",
			Level:   "good",
			Title:   "血压控制良好",
			Message: "您的平均血压处于正常范围，继续保持健康的生活方式。",
		})
	}

	// 2. Consecutive high readings
	if maxConsecutiveHigh >= 3 {
		insights = append(insights, Insight{
			Type:    "risk",
			Level:   "warning",
			Title:   "连续高血压读数",
			Message: formatConsecutiveHighMsg(maxConsecutiveHigh),
		})
	}

	// 3. Large variability
	sysRange := maxSys - minSys
	if sysRange > 40 && len(records) >= 5 {
		insights = append(insights, Insight{
			Type:    "info",
			Level:   "info",
			Title:   "血压波动较大",
			Message: "您的收缩压波动范围较大（" + intToStr(sysRange) + " mmHg），波动过大可能需要关注，建议保持规律测量并咨询医生。",
		})
	}

	// 4. Morning vs evening comparison
	if morningCount >= 3 && eveningCount >= 3 {
		diff := morningAvgSys - eveningAvgSys
		if diff > 15 {
			insights = append(insights, Insight{
				Type:    "info",
				Level:   "info",
				Title:   "晨间血压偏高",
				Message: "您的晨间血压平均比晚间高出较多，晨间高血压需要特别关注，建议就此咨询医生。",
			})
		}
	}

	// 5. Measurement frequency
	expectedMeasurements := days
	if len(records) < expectedMeasurements/3 {
		insights = append(insights, Insight{
			Type:    "tip",
			Level:   "info",
			Title:   "建议增加测量频率",
			Message: "过去" + intToStr(days) + "天内仅有" + intToStr(len(records)) + "条记录。建议每天至少测量一次，以获得更准确的趋势分析。",
		})
	}

	// 6. Trend analysis (compare first half vs second half)
	if len(records) >= 6 {
		mid := len(records) / 2
		firstHalfAvg := 0.0
		for _, r := range records[:mid] {
			firstHalfAvg += float64(r.Systolic)
		}
		firstHalfAvg /= float64(mid)

		secondHalfAvg := 0.0
		for _, r := range records[mid:] {
			secondHalfAvg += float64(r.Systolic)
		}
		secondHalfAvg /= float64(len(records) - mid)

		diff := secondHalfAvg - firstHalfAvg
		if diff > 10 {
			insights = append(insights, Insight{
				Type:    "risk",
				Level:   "warning",
				Title:   "血压呈上升趋势",
				Message: "与前期相比，近期收缩压平均上升了约" + intToStr(int(math.Round(diff))) + " mmHg，建议关注并咨询医生。",
			})
		} else if diff < -10 {
			insights = append(insights, Insight{
				Type:    "positive",
				Level:   "good",
				Title:   "血压呈下降趋势",
				Message: "与前期相比，近期收缩压平均下降了约" + intToStr(int(math.Round(-diff))) + " mmHg，趋势良好。",
			})
		}
	}

	// Disclaimer
	insights = append(insights, Insight{
		Type:    "disclaimer",
		Level:   "info",
		Title:   "免责声明",
		Message: "以上分析仅基于您的历史记录生成，不构成医疗诊断或治疗建议。如有健康疑虑，请咨询专业医生。",
	})

	resp := InsightsResponse{
		Period:        formatPeriod(days),
		RecordCount:   len(records),
		AvgSystolic:   math.Round(avgSys*10) / 10,
		AvgDiastolic:  math.Round(avgDia*10) / 10,
		AvgHeartRate:  math.Round(avgHR*10) / 10,
		MaxSystolic:   maxSys,
		MinSystolic:   minSys,
		MaxDiastolic:  maxDia,
		MinDiastolic:  minDia,
		Insights:      insights,
		MorningAvgSys: math.Round(morningAvgSys*10) / 10,
		EveningAvgSys: math.Round(eveningAvgSys*10) / 10,
	}

	// Log analytics
	db.Pool.Exec(ctx,
		`INSERT INTO analytics_events (user_id, event_type, event_data) VALUES ($1, 'view_insights', $2)`,
		openid, `{"days": `+intToStr(days)+`}`)

	log.Info("health insights generated", "openid", openid, "records", len(records), "insights", len(insights))
	c.JSON(http.StatusOK, resp)
}

func parseInt(s string) int {
	v := 0
	for _, c := range s {
		if c >= '0' && c <= '9' {
			v = v*10 + int(c-'0')
		}
	}
	return v
}

func formatPeriod(days int) string {
	if days <= 7 {
		return "近一周"
	} else if days <= 30 {
		return "近一个月"
	} else if days <= 90 {
		return "近三个月"
	}
	return "近" + intToStr(days) + "天"
}

func formatConsecutiveHighMsg(count int) string {
	return "检测到连续" + intToStr(count) + "次血压偏高读数。持续的高血压需要医疗关注，建议尽快咨询医生。"
}
