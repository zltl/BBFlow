package handlers

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"

	"bbflow-server/db"

	"github.com/gin-gonic/gin"
)

type GenerateTokenRequest struct {
	TimeRange       string `json:"timeRange" binding:"required"`
	ShareFutureData bool   `json:"shareFutureData"`
}

func GenerateShareToken(c *gin.Context) {
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
	rand.Read(tokenBytes)
	token := hex.EncodeToString(tokenBytes)

	expiresAt := time.Now().AddDate(0, 0, 7)

	_, err := db.Pool.Exec(context.Background(),
		`INSERT INTO share_tokens (token, user_id, time_range, share_future_data, expires_at)
		 VALUES ($1, $2, $3, $4, $5)`,
		token, openid, req.TimeRange, req.ShareFutureData, expiresAt)
	if err != nil {
		log.Println("Error generating share token:", err)
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
	err := db.Pool.QueryRow(ctx,
		`SELECT user_id, time_range, share_future_data, expires_at, created_at 
		 FROM share_tokens WHERE token = $1`, token).Scan(
		&shareInfo.UserID, &shareInfo.TimeRange, &shareInfo.ShareFutureData,
		&shareInfo.ExpiresAt, &shareInfo.CreatedAt)
	if err != nil {
		return Owner{}, nil, nil, fmt.Errorf("invalid token")
	}

	if time.Now().After(shareInfo.ExpiresAt) {
		return Owner{}, nil, nil, fmt.Errorf("token expired")
	}

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

	owner, records, meta, err := getShareData(token, page, pageSize)
	if err != nil {
		if err.Error() == "invalid token" {
			c.JSON(http.StatusNotFound, gin.H{"error": "Invalid token"})
		} else if err.Error() == "token expired" {
			c.JSON(http.StatusGone, gin.H{"error": "Token expired"})
		} else {
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

	owner, records, meta, err := getShareData(token, 1, 20)
	if err != nil {
		if err.Error() == "invalid token" {
			c.String(http.StatusNotFound, "<h1>无效的分享链接</h1>")
		} else if err.Error() == "token expired" {
			c.String(http.StatusGone, "<h1>分享链接已过期</h1>")
		} else {
			c.String(http.StatusInternalServerError, "<h1>无法加载分享数据</h1>")
		}
		return
	}

	nickname := "用户"
	if owner.Nickname != nil {
		nickname = *owner.Nickname
	}

	avatarURL := "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSI1MCIgZmlsbD0iI2VlZSIvPjxwYXRoIGQ9Ik01MCA1MGMtMTIgMC0yMi0xMC0yMi0yMnMxMC0yMiAyMi0yMiAyMiAxMCAyMiAyMi0xMCAyMi0yMiAyMnptMCAxMGMtMjAgMC00MCAxMC00MCAzMHYxMGg4MFY5MGMwLTIwLTIwLTMwLTQwLTMweiIgZmlsbD0iI2NjYyIvPjwvc3ZnPg=="
	if owner.AvatarURL != nil && *owner.AvatarURL != "" {
		avatarURL = *owner.AvatarURL
	}

	// Build records HTML
	recordsHTML := buildRecordsHTML(records)
	if len(records) == 0 {
		recordsHTML = `<div class="empty">暂无符合条件的数据</div>`
	}

	// Simplified HTML template (same structure as Node.js version)
	html := fmt.Sprintf(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>%s的血压记录 - 安压宝</title>
  <script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #f4f5f5; margin: 0; padding: 20px; color: #333; }
    .container { max-width: 600px; margin: 0 auto; }
    .header { background: #fff; padding: 20px; border-radius: 12px; margin-bottom: 20px; display: flex; align-items: center; gap: 15px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
    .avatar { width: 50px; height: 50px; border-radius: 50%%; background: #eee; object-fit: cover; }
    .info h1 { margin: 0; font-size: 18px; }
    .meta { font-size: 12px; color: #999; margin-top: 4px; }
    .date-group { margin-bottom: 20px; }
    .date-header { font-size: 14px; color: #666; margin-bottom: 10px; padding-left: 5px; }
    .record-card { background: #fff; border-radius: 12px; padding: 15px 20px; margin-bottom: 10px; display: flex; align-items: center; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    .record-left { width: 60px; margin-right: 15px; }
    .record-time { font-size: 18px; font-weight: bold; color: #333; margin-bottom: 2px; }
    .record-period { font-size: 12px; color: #999; background: #f5f5f5; padding: 1px 6px; border-radius: 4px; display: inline-block; }
    .record-main { flex: 1; display: flex; justify-content: space-between; align-items: center; }
    .bp-value { font-size: 28px; font-weight: bold; color: #333; font-family: "DIN Alternate", sans-serif; }
    .record-right { display: flex; align-items: center; gap: 10px; }
    .bp-tag { font-size: 12px; padding: 2px 8px; border-radius: 10px; }
    .bp-tag.level3 { color: #cf1322; background: #fff1f0; }
    .bp-tag.level2 { color: #ff4d4f; background: #fff2f0; }
    .bp-tag.level1 { color: #fa8c16; background: #fff7e6; }
    .bp-tag.normal-high { color: #faad14; background: #fffbe6; }
    .bp-tag.normal { color: #52c41a; background: #f6ffed; }
    .hr-value { font-size: 16px; font-weight: bold; color: #333; display: flex; align-items: center; gap: 4px; }
    .heart-icon { color: #ff4d4f; font-size: 12px; }
    .empty { text-align: center; color: #999; padding: 40px; }
    .footer { text-align: center; margin-top: 40px; color: #999; font-size: 12px; }
    .loading { text-align: center; padding: 20px; color: #999; display: none; }
    .chart-card { background: #fff; border-radius: 12px; padding: 15px; margin-bottom: 15px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
    .chart-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
    .chart-title { font-size: 16px; font-weight: bold; color: #333; }
    .chart-legend { display: flex; gap: 10px; font-size: 12px; color: #666; }
    .legend-item { display: flex; align-items: center; gap: 4px; }
    .dot { width: 8px; height: 8px; border-radius: 50%%; }
    .dot.high { background: #ff4d4f; }
    .dot.low { background: #1890ff; }
    .dot.hr { background: #52c41a; }
    .chart-legend-group { display: flex; flex-direction: column; align-items: flex-end; gap: 5px; }
    .chart-legend-zones { display: flex; gap: 8px; font-size: 10px; color: #999; }
    .zone-item { display: flex; align-items: center; gap: 3px; }
    .zone-box { width: 8px; height: 8px; border-radius: 2px; }
    .zone-box.normal { background: rgba(82, 196, 26, 0.2); }
    .zone-box.level1 { background: rgba(250, 173, 20, 0.2); }
    .zone-box.level2 { background: rgba(255, 77, 79, 0.2); }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img class="avatar" src="%s" alt="Avatar">
      <div class="info">
        <h1>%s的血压记录</h1>
        <div class="meta">有效期至: %s</div>
      </div>
    </div>
    <div class="chart-card">
      <div class="chart-header">
        <div class="chart-title">血压趋势</div>
        <div class="chart-legend-group">
          <div class="chart-legend-zones">
            <span class="zone-item"><span class="zone-box normal"></span>正常</span>
            <span class="zone-item"><span class="zone-box level1"></span>一级</span>
            <span class="zone-item"><span class="zone-box level2"></span>危险</span>
          </div>
          <div class="chart-legend">
            <div class="legend-item"><span class="dot high"></span>收缩压</div>
            <div class="legend-item"><span class="dot low"></span>舒张压</div>
          </div>
        </div>
      </div>
      <div id="chartBP" style="width: 100%%; height: 250px;"></div>
    </div>
    <div class="chart-card">
      <div class="chart-header">
        <div class="chart-title">心率趋势</div>
        <div class="chart-legend">
          <div class="legend-item"><span class="dot hr"></span>心率</div>
        </div>
      </div>
      <div id="chartHR" style="width: 100%%; height: 200px;"></div>
    </div>
    <div class="list" id="recordList">%s</div>
    <div class="loading" id="loading">加载中...</div>
    <div class="footer">
      <p>由「安压宝」提供技术支持</p>
    </div>
  </div>
  <script>
    var token = "%s";
    var hasMore = %t;
    // Charts and lazy loading JS would go here (same as Node.js version)
  </script>
</body>
</html>`,
		nickname, avatarURL, nickname, meta["expiresAt"], recordsHTML, token, meta["hasMore"].(bool))

	c.Header("Content-Type", "text/html; charset=utf-8")
	c.String(http.StatusOK, html)
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
