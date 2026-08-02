package handlers

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"html"
	"net/http"
	"strconv"
	"time"

	"bbflow-server/db"
	"bbflow-server/logging"

	"github.com/gin-gonic/gin"
)

type GenerateTokenRequest struct {
	TimeRange       string `json:"timeRange" binding:"required"`
	ShareFutureData bool   `json:"shareFutureData"`
}

func GenerateShareToken(c *gin.Context) {
	log := logging.FromGin(c)
	openid := c.GetString("openid")
	if openid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	var req GenerateTokenRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Missing required fields"})
		return
	}

	// Generate random token
	tokenBytes := make([]byte, 16)
	if _, err := rand.Read(tokenBytes); err != nil {
		log.Error("failed to generate random token", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
		return
	}
	token := hex.EncodeToString(tokenBytes)

	expiresAt := time.Now().AddDate(0, 0, 7)

	_, err := db.Pool.Exec(context.Background(),
		`INSERT INTO share_tokens (token, user_id, time_range, share_future_data, expires_at)
		 VALUES ($1, $2, $3, $4, $5)`,
		token, openid, req.TimeRange, req.ShareFutureData, expiresAt)
	if err != nil {
		log.Error("failed to generate share token", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"token":      token,
		"expiration": expiresAt.Format(time.RFC3339),
	})
}

type ShareInfo struct {
	UserID          string    `json:"user_id"`
	TimeRange       string    `json:"time_range"`
	ShareFutureData bool      `json:"share_future_data"`
	ExpiresAt       time.Time `json:"expires_at"`
	CreatedAt       time.Time `json:"created_at"`
}

type ShareRecord struct {
	Systolic   int       `json:"systolic"`
	Diastolic  int       `json:"diastolic"`
	HeartRate  *int      `json:"heart_rate"`
	MeasuredAt time.Time `json:"measured_at"`
	Tags       string    `json:"tags"`
	Note       string    `json:"note"`
}

type Owner struct {
	Nickname  *string `json:"nickname"`
	AvatarURL *string `json:"avatar_url"`
}

func getShareData(token string, page, pageSize int) (Owner, []ShareRecord, map[string]interface{}, error) {
	ctx := context.Background()

	var shareInfo ShareInfo
	var isRevoked bool
	err := db.Pool.QueryRow(ctx,
		`SELECT user_id, time_range, share_future_data, expires_at, created_at, COALESCE(is_revoked, false)
		 FROM share_tokens WHERE token = $1`, token).Scan(
		&shareInfo.UserID, &shareInfo.TimeRange, &shareInfo.ShareFutureData,
		&shareInfo.ExpiresAt, &shareInfo.CreatedAt, &isRevoked)
	if err != nil {
		return Owner{}, nil, nil, fmt.Errorf("invalid token")
	}

	if isRevoked {
		return Owner{}, nil, nil, fmt.Errorf("token revoked")
	}

	if time.Now().After(shareInfo.ExpiresAt) {
		return Owner{}, nil, nil, fmt.Errorf("token expired")
	}

	// Update access stats
	db.Pool.Exec(ctx,
		`UPDATE share_tokens SET access_count = COALESCE(access_count, 0) + 1, last_accessed_at = $1 WHERE token = $2`,
		time.Now(), token)

	// Build query
	query := `SELECT systolic, diastolic, heart_rate, measured_at, tags, note 
			  FROM bp_records WHERE user_id = $1`
	args := []interface{}{shareInfo.UserID}
	argIdx := 2

	if shareInfo.TimeRange != "all" {
		days, _ := strconv.Atoi(shareInfo.TimeRange)
		startDate := time.Now().AddDate(0, 0, -days)
		query += fmt.Sprintf(" AND measured_at >= $%d", argIdx)
		args = append(args, startDate)
		argIdx++
	}

	if !shareInfo.ShareFutureData {
		query += fmt.Sprintf(" AND measured_at <= $%d", argIdx)
		args = append(args, shareInfo.CreatedAt)
		argIdx++
	}

	query += " ORDER BY measured_at DESC"
	query += fmt.Sprintf(" LIMIT $%d OFFSET $%d", argIdx, argIdx+1)
	args = append(args, pageSize, (page-1)*pageSize)

	rows, err := db.Pool.Query(ctx, query, args...)
	if err != nil {
		return Owner{}, nil, nil, err
	}
	defer rows.Close()

	var records []ShareRecord
	for rows.Next() {
		var r ShareRecord
		if err := rows.Scan(&r.Systolic, &r.Diastolic, &r.HeartRate, &r.MeasuredAt, &r.Tags, &r.Note); err != nil {
			return Owner{}, nil, nil, err
		}
		records = append(records, r)
	}

	var owner Owner
	db.Pool.QueryRow(ctx, `SELECT nickname, avatar_url FROM users WHERE openid = $1`,
		shareInfo.UserID).Scan(&owner.Nickname, &owner.AvatarURL)

	meta := map[string]interface{}{
		"timeRange": shareInfo.TimeRange,
		"expiresAt": shareInfo.ExpiresAt.Format(time.RFC3339),
		"page":      page,
		"pageSize":  pageSize,
		"hasMore":   len(records) == pageSize,
	}

	return owner, records, meta, nil
}

func ViewShareData(c *gin.Context) {
	token := c.Param("token")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("pageSize", "20"))

	// Log access audit
	db.Pool.Exec(context.Background(),
		`INSERT INTO share_access_logs (token, accessor_ip, user_agent) VALUES ($1, $2, $3)`,
		token, c.ClientIP(), c.Request.UserAgent())

	owner, records, meta, err := getShareData(token, page, pageSize)
	if err != nil {
		switch err.Error() {
		case "invalid token":
			c.JSON(http.StatusNotFound, gin.H{"error": "Invalid token"})
		case "token expired":
			c.JSON(http.StatusGone, gin.H{"error": "Token expired"})
		case "token revoked":
			c.JSON(http.StatusGone, gin.H{"error": "Token has been revoked"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve data"})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"owner":   owner,
		"records": records,
		"meta":    meta,
	})
}

func ViewShareHTML(c *gin.Context) {
	token := c.Param("token")

	db.Pool.Exec(context.Background(),
		`INSERT INTO share_access_logs (token, accessor_ip, user_agent) VALUES ($1, $2, $3)`,
		token, c.ClientIP(), c.Request.UserAgent())

	owner, records, meta, err := getShareData(token, 1, 200)
	if err != nil {
		switch err.Error() {
		case "invalid token":
			c.String(http.StatusNotFound, "<h1>无效的分享链接</h1>")
		case "token expired":
			c.String(http.StatusGone, "<h1>分享链接已过期</h1>")
		case "token revoked":
			c.String(http.StatusGone, "<h1>分享链接已被撤销</h1>")
		default:
			c.String(http.StatusInternalServerError, "<h1>无法加载分享数据</h1>")
		}
		return
	}

	nickname := "用户"
	if owner.Nickname != nil {
		nickname = *owner.Nickname
	}
	nickname = html.EscapeString(nickname)

	avatarURL := "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSI1MCIgZmlsbD0iI2VlZSIvPjxwYXRoIGQ9Ik01MCA1MGMtMTIgMC0yMi0xMC0yMi0yMnMxMC0yMiAyMi0yMiAyMiAxMCAyMiAyMi0xMCAyMi0yMiAyMnptMCAxMGMtMjAgMC00MCAxMC00MCAzMHYxMGg4MFY5MGMwLTIwLTIwLTMwLTQwLTMweiIgZmlsbD0iI2NjYyIvPjwvc3ZnPg=="
	if owner.AvatarURL != nil && *owner.AvatarURL != "" {
		avatarURL = html.EscapeString(*owner.AvatarURL)
	}

	summary := computeShareSummary(records)
	recordsHTML := buildRecordsHTML(records)
	if len(records) == 0 {
		recordsHTML = `<div class="empty">暂无符合条件的数据</div>`
	}

	// Chart series chronological
	type chartPoint struct {
		Label string `json:"label"`
		Sys   int    `json:"sys"`
		Dia   int    `json:"dia"`
		HR    int    `json:"hr"`
	}
	points := make([]chartPoint, 0, len(records))
	for i := len(records) - 1; i >= 0; i-- {
		r := records[i]
		hr := 0
		if r.HeartRate != nil {
			hr = *r.HeartRate
		}
		points = append(points, chartPoint{
			Label: r.MeasuredAt.Format("01-02 15:04"),
			Sys:   r.Systolic,
			Dia:   r.Diastolic,
			HR:    hr,
		})
	}
	pointsJSON, _ := json.Marshal(points)
	expiresAt := html.EscapeString(fmt.Sprint(meta["expiresAt"]))

	page := fmt.Sprintf(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>%s的血压记录 - 安压宝</title>
  <script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #f4f5f5; margin: 0; padding: 20px; color: #333; }
    .container { max-width: 640px; margin: 0 auto; }
    .header { background: #fff; padding: 20px; border-radius: 12px; margin-bottom: 16px; display: flex; align-items: center; gap: 15px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
    .avatar { width: 50px; height: 50px; border-radius: 50%%; background: #eee; object-fit: cover; }
    .info h1 { margin: 0; font-size: 18px; }
    .meta { font-size: 12px; color: #999; margin-top: 4px; }
    .summary-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 16px; }
    .summary-card { background: #fff; border-radius: 12px; padding: 14px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
    .summary-value { font-size: 22px; font-weight: 700; color: #1677ff; }
    .summary-label { margin-top: 4px; font-size: 12px; color: #888; }
    .disclaimer { background: #fffbe6; color: #ad6800; border-radius: 10px; padding: 10px 12px; font-size: 12px; margin-bottom: 16px; line-height: 1.5; }
    .date-group { margin-bottom: 20px; }
    .date-header { font-size: 14px; color: #666; margin-bottom: 10px; padding-left: 5px; }
    .record-card { background: #fff; border-radius: 12px; padding: 15px 20px; margin-bottom: 10px; display: flex; align-items: center; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    .record-left { width: 60px; margin-right: 15px; }
    .record-time { font-size: 18px; font-weight: bold; color: #333; margin-bottom: 2px; }
    .record-period { font-size: 12px; color: #999; background: #f5f5f5; padding: 1px 6px; border-radius: 4px; display: inline-block; }
    .record-main { flex: 1; display: flex; justify-content: space-between; align-items: center; }
    .bp-value { font-size: 28px; font-weight: bold; color: #333; }
    .record-right { display: flex; align-items: center; gap: 10px; }
    .bp-tag { font-size: 12px; padding: 2px 8px; border-radius: 10px; }
    .bp-tag.level3 { color: #cf1322; background: #fff1f0; }
    .bp-tag.level2 { color: #ff4d4f; background: #fff2f0; }
    .bp-tag.level1 { color: #fa8c16; background: #fff7e6; }
    .bp-tag.normal-high { color: #faad14; background: #fffbe6; }
    .bp-tag.normal { color: #52c41a; background: #f6ffed; }
    .hr-value { font-size: 16px; font-weight: bold; color: #333; }
    .empty { text-align: center; color: #999; padding: 40px; }
    .footer { text-align: center; margin-top: 40px; color: #999; font-size: 12px; }
    .chart-card { background: #fff; border-radius: 12px; padding: 15px; margin-bottom: 15px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
    .chart-title { font-size: 16px; font-weight: bold; color: #333; margin-bottom: 10px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img class="avatar" src="%s" alt="Avatar">
      <div class="info">
        <h1>%s的血压记录</h1>
        <div class="meta">有效期至: %s · 仅供健康管理参考，不构成医疗诊断</div>
      </div>
    </div>
    <div class="disclaimer">本页面数据由用户主动分享，健康洞察仅供参考，请遵医嘱。</div>
    <div class="summary-grid">
      <div class="summary-card"><div class="summary-value">%d</div><div class="summary-label">记录数</div></div>
      <div class="summary-card"><div class="summary-value">%d/%d</div><div class="summary-label">平均血压</div></div>
      <div class="summary-card"><div class="summary-value">%d%%</div><div class="summary-label">达标率(&lt;140/90)</div></div>
      <div class="summary-card"><div class="summary-value">%d</div><div class="summary-label">异常次数</div></div>
    </div>
    <div class="chart-card">
      <div class="chart-title">血压趋势</div>
      <div id="chartBP" style="width: 100%%; height: 260px;"></div>
    </div>
    <div class="chart-card">
      <div class="chart-title">心率趋势</div>
      <div id="chartHR" style="width: 100%%; height: 200px;"></div>
    </div>
    <div class="list" id="recordList">%s</div>
    <div class="footer"><p>由「安压宝」提供技术支持</p></div>
  </div>
  <script>
    var points = %s;
    function renderCharts() {
      if (!window.echarts || !points.length) return;
      var labels = points.map(function(p){ return p.label; });
      var sys = points.map(function(p){ return p.sys; });
      var dia = points.map(function(p){ return p.dia; });
      var hr = points.map(function(p){ return p.hr; });
      var bpChart = echarts.init(document.getElementById('chartBP'));
      bpChart.setOption({
        grid: { left: 40, right: 16, top: 24, bottom: 40 },
        tooltip: { trigger: 'axis' },
        xAxis: { type: 'category', data: labels, axisLabel: { rotate: 35, fontSize: 10 } },
        yAxis: { type: 'value', min: 40, max: 220 },
        series: [
          { name: '收缩压', type: 'line', data: sys, smooth: true, itemStyle: { color: '#ff4d4f' } },
          { name: '舒张压', type: 'line', data: dia, smooth: true, itemStyle: { color: '#1890ff' } }
        ]
      });
      var hrChart = echarts.init(document.getElementById('chartHR'));
      hrChart.setOption({
        grid: { left: 40, right: 16, top: 24, bottom: 40 },
        tooltip: { trigger: 'axis' },
        xAxis: { type: 'category', data: labels, axisLabel: { rotate: 35, fontSize: 10 } },
        yAxis: { type: 'value', min: 40, max: 160 },
        series: [{ name: '心率', type: 'line', data: hr, smooth: true, itemStyle: { color: '#52c41a' } }]
      });
      window.addEventListener('resize', function(){ bpChart.resize(); hrChart.resize(); });
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', renderCharts);
    } else { renderCharts(); }
  </script>
</body>
</html>`,
		nickname, avatarURL, nickname, expiresAt,
		summary.Count, summary.AvgSys, summary.AvgDia, summary.NormalRate, summary.AbnormalCount,
		recordsHTML, string(pointsJSON))

	c.Header("Content-Type", "text/html; charset=utf-8")
	c.String(http.StatusOK, page)
}

type shareSummary struct {
	Count         int
	AvgSys        int
	AvgDia        int
	NormalRate    int
	AbnormalCount int
}

func computeShareSummary(records []ShareRecord) shareSummary {
	s := shareSummary{Count: len(records)}
	if len(records) == 0 {
		return s
	}
	sumSys, sumDia, normal := 0, 0, 0
	for _, r := range records {
		sumSys += r.Systolic
		sumDia += r.Diastolic
		if r.Systolic < 140 && r.Diastolic < 90 {
			normal++
		} else {
			s.AbnormalCount++
		}
	}
	s.AvgSys = sumSys / len(records)
	s.AvgDia = sumDia / len(records)
	s.NormalRate = normal * 100 / len(records)
	return s
}

func getBPLevel(sys, dia int) (string, string) {
	if sys >= 180 || dia >= 110 {
		return "三级高血压", "level3"
	}
	if sys >= 160 || dia >= 100 {
		return "二级高血压", "level2"
	}
	if sys >= 140 || dia >= 90 {
		return "一级高血压", "level1"
	}
	if sys >= 120 || dia >= 80 {
		return "正常高值", "normal-high"
	}
	return "正常血压", "normal"
}

func getPeriod(t time.Time) string {
	h := t.Hour()
	if h >= 5 && h < 11 {
		return "morning"
	}
	if h >= 11 && h < 13 {
		return "noon"
	}
	if h >= 13 && h < 18 {
		return "afternoon"
	}
	if h >= 18 && h < 23 {
		return "evening"
	}
	return "night"
}

func buildRecordsHTML(records []ShareRecord) string {
	grouped := make(map[string][]ShareRecord)
	var dateOrder []string

	for _, r := range records {
		dateKey := fmt.Sprintf("%d月%d日", r.MeasuredAt.Month(), r.MeasuredAt.Day())
		if _, exists := grouped[dateKey]; !exists {
			dateOrder = append(dateOrder, dateKey)
		}
		grouped[dateKey] = append(grouped[dateKey], r)
	}

	html := ""
	for _, date := range dateOrder {
		group := grouped[date]
		html += fmt.Sprintf(`<div class="date-group"><div class="date-header">%s</div>`, date)
		for _, r := range group {
			timeStr := fmt.Sprintf("%02d:%02d", r.MeasuredAt.Hour(), r.MeasuredAt.Minute())
			period := getPeriod(r.MeasuredAt)
			label, class := getBPLevel(r.Systolic, r.Diastolic)

			hrStr := "--"
			if r.HeartRate != nil {
				hrStr = strconv.Itoa(*r.HeartRate)
			}

			html += fmt.Sprintf(`
        <div class="record-card">
          <div class="record-left">
            <div class="record-time">%s</div>
            <div class="record-period">%s</div>
          </div>
          <div class="record-main">
            <div class="bp-value">%d/%d</div>
            <div class="record-right">
              <span class="bp-tag %s">%s</span>
              <span class="hr-value">%s <span class="heart-icon">❤️</span></span>
            </div>
          </div>
        </div>`, timeStr, period, r.Systolic, r.Diastolic, class, label, hrStr)
		}
		html += `</div>`
	}
	return html
}
