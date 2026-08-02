package handlers

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"bbflow-server/config"
	"bbflow-server/db"
	"bbflow-server/logging"
	"bbflow-server/utils"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
)

type Plan struct {
	ID           int    `json:"id"`
	Name         string `json:"name"`
	Description  string `json:"description"`
	PriceCents   int    `json:"price_cents"`
	DurationDays int    `json:"duration_days"`
	MaxRecords   int    `json:"max_records"`
	Features     string `json:"features"`
	IsActive     bool   `json:"is_active"`
	CreatedAt    string `json:"created_at"`
}

func ListPlans(c *gin.Context) {
	ctx := context.Background()
	rows, err := db.Pool.Query(ctx, `
SELECT id, name, description, price_cents, duration_days, max_records, features, is_active, created_at
FROM plans WHERE is_active = true ORDER BY price_cents ASC
`)
	if err != nil {
		logging.FromGin(c).Error("failed to query plans", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询套餐失败"})
		return
	}
	defer rows.Close()

	var plans []Plan
	for rows.Next() {
		var p Plan
		if err := rows.Scan(&p.ID, &p.Name, &p.Description, &p.PriceCents, &p.DurationDays, &p.MaxRecords, &p.Features, &p.IsActive, &p.CreatedAt); err != nil {
			continue
		}
		plans = append(plans, p)
	}
	if plans == nil {
		plans = []Plan{}
	}
	c.JSON(http.StatusOK, gin.H{"plans": plans})
}

func CreateOrder(c *gin.Context) {
	openid := c.GetString("openid")
	logger := logging.FromGin(c)
	ctx := context.Background()

	var req struct {
		PlanID int `json:"plan_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请选择套餐"})
		return
	}

	var plan Plan
	err := db.Pool.QueryRow(ctx, `
SELECT id, name, price_cents, duration_days, max_records FROM plans WHERE id = $1 AND is_active = true
`, req.PlanID).Scan(&plan.ID, &plan.Name, &plan.PriceCents, &plan.DurationDays, &plan.MaxRecords)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "套餐不存在或已下架"})
		return
	}

	var userID int
	err = db.Pool.QueryRow(ctx, `SELECT id FROM users WHERE openid = $1`, openid).Scan(&userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "用户不存在"})
		return
	}

	orderNo := time.Now().Format("20060102150405") + fmt.Sprintf("%06d", userID)

	var orderID int
	err = db.Pool.QueryRow(ctx, `
INSERT INTO payment_orders (user_id, plan_id, order_no, amount_cents, status, created_at)
VALUES ($1, $2, $3, $4, 'pending', NOW()) RETURNING id
`, userID, plan.ID, orderNo, plan.PriceCents).Scan(&orderID)
	if err != nil {
		logger.Error("failed to create order", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建订单失败"})
		return
	}

	logger.Info("payment order created", "order_id", orderID, "plan_id", plan.ID, "amount", plan.PriceCents)

	cfg := config.AppConfig
	paymentReady := cfg.WxPay.MchID != "" && cfg.WxPay.APIKey != "" && cfg.Wx.AppID != "" && cfg.WxPay.NotifyURL != ""

	resp := gin.H{
		"order_id":       orderID,
		"order_no":       orderNo,
		"amount_cents":   plan.PriceCents,
		"plan_name":      plan.Name,
		"status":         "pending",
		"payment_ready":  paymentReady,
		"message":        "订单已创建，请完成支付",
	}

	if paymentReady {
		clientIP := c.ClientIP()
		if clientIP == "" || clientIP == "::1" {
			clientIP = "127.0.0.1"
		}
		prepayID, err := utils.UnifiedOrderJSAPI(
			cfg.Wx.AppID, cfg.WxPay.MchID, cfg.WxPay.APIKey,
			openid, orderNo, "安压宝-"+plan.Name, cfg.WxPay.NotifyURL,
			plan.PriceCents, clientIP,
		)
		if err != nil {
			logger.Error("unified order failed", "error", err, "order_no", orderNo)
			c.JSON(http.StatusBadGateway, gin.H{"error": "微信支付下单失败: " + err.Error(), "order_no": orderNo, "status": "pending"})
			return
		}
		payParams := utils.BuildJSAPIPayParams(cfg.Wx.AppID, cfg.WxPay.APIKey, prepayID)
		resp["payment"] = gin.H{
			"timeStamp": payParams["timeStamp"],
			"nonceStr":  payParams["nonceStr"],
			"package":   payParams["package"],
			"signType":  payParams["signType"],
			"paySign":   payParams["paySign"],
		}
	} else {
		resp["message"] = "订单已创建。服务端尚未配置微信支付商户参数，可使用管理员手动确认支付。"
	}

	c.JSON(http.StatusOK, resp)
}

// completePaidOrder marks a pending order paid and extends subscription (idempotent).
func completePaidOrder(ctx context.Context, orderNo, tradeNo, paymentMethod string) (time.Time, error) {
	tx, err := db.Pool.Begin(ctx)
	if err != nil {
		return time.Time{}, err
	}
	defer tx.Rollback(ctx)

	var orderID, userID, planID, amountCents int
	var status string
	err = tx.QueryRow(ctx, `
SELECT id, user_id, plan_id, amount_cents, status FROM payment_orders WHERE order_no = $1 FOR UPDATE
`, orderNo).Scan(&orderID, &userID, &planID, &amountCents, &status)
	if err != nil {
		return time.Time{}, fmt.Errorf("order not found")
	}
	if status == "paid" {
		var paidUntil time.Time
		_ = tx.QueryRow(ctx, `SELECT paid_until FROM users WHERE id = $1`, userID).Scan(&paidUntil)
		return paidUntil, nil
	}
	if status != "pending" {
		return time.Time{}, fmt.Errorf("invalid order status: %s", status)
	}

	var durationDays int
	if err := tx.QueryRow(ctx, `SELECT duration_days FROM plans WHERE id = $1`, planID).Scan(&durationDays); err != nil {
		return time.Time{}, err
	}

	_, err = tx.Exec(ctx, `
UPDATE payment_orders SET status = 'paid', trade_no = $1, payment_method = $2, paid_at = NOW() WHERE id = $3
`, tradeNo, paymentMethod, orderID)
	if err != nil {
		return time.Time{}, err
	}

	paidUntil := time.Now().AddDate(0, 0, durationDays)
	var existingPaidUntil *time.Time
	err = tx.QueryRow(ctx, `SELECT paid_until FROM users WHERE id = $1`, userID).Scan(&existingPaidUntil)
	if err == nil && existingPaidUntil != nil && existingPaidUntil.After(time.Now()) {
		paidUntil = existingPaidUntil.AddDate(0, 0, durationDays)
	}

	if _, err := tx.Exec(ctx, `UPDATE users SET paid_until = $1 WHERE id = $2`, paidUntil, userID); err != nil {
		return time.Time{}, err
	}

	if _, err := tx.Exec(ctx, `
INSERT INTO subscriptions (user_id, plan_id, order_id, starts_at, expires_at, status, created_at)
VALUES ($1, $2, $3, NOW(), $4, 'active', NOW())
`, userID, planID, orderID, paidUntil); err != nil {
		return time.Time{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return time.Time{}, err
	}
	return paidUntil, nil
}

// PaymentNotify handles WeChat Pay v2 XML notifications with signature verification.
func PaymentNotify(c *gin.Context) {
	logger := logging.FromGin(c)
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.Data(http.StatusOK, "application/xml", []byte(utils.WxPayNotifyFailXML("read body")))
		return
	}

	apiKey := config.AppConfig.WxPay.APIKey
	ok, notify := utils.VerifyWxPayNotifyXML(body, apiKey)
	if apiKey == "" || !ok || notify == nil {
		logger.Warn("payment notify sign invalid")
		c.Data(http.StatusOK, "application/xml", []byte(utils.WxPayNotifyFailXML("sign")))
		return
	}
	if notify.ReturnCode != "SUCCESS" || notify.ResultCode != "SUCCESS" {
		c.Data(http.StatusOK, "application/xml", []byte(utils.WxPayNotifyFailXML("result")))
		return
	}

	paidUntil, err := completePaidOrder(context.Background(), notify.OutTradeNo, notify.TransactionID, "wechat")
	if err != nil {
		logger.Error("payment notify complete failed", "error", err, "order_no", notify.OutTradeNo)
		c.Data(http.StatusOK, "application/xml", []byte(utils.WxPayNotifyFailXML("process")))
		return
	}

	logger.Info("payment notify success", "order_no", notify.OutTradeNo, "paid_until", paidUntil)
	c.Data(http.StatusOK, "application/xml", []byte(utils.WxPayNotifySuccessXML()))
}

// PaymentCallback is an admin-authenticated manual payment confirm (requires X-Admin-Secret).
func PaymentCallback(c *gin.Context) {
	logger := logging.FromGin(c)
	secret := config.AppConfig.AdminSecret
	if secret == "" || c.GetHeader("X-Admin-Secret") != secret {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "未授权"})
		return
	}

	var req struct {
		OrderNo       string `json:"order_no" binding:"required"`
		TradeNo       string `json:"trade_no"`
		PaymentMethod string `json:"payment_method"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}
	if req.PaymentMethod == "" {
		req.PaymentMethod = "manual"
	}
	if req.TradeNo == "" {
		req.TradeNo = "manual-" + time.Now().Format("20060102150405")
	}

	paidUntil, err := completePaidOrder(context.Background(), req.OrderNo, req.TradeNo, req.PaymentMethod)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			c.JSON(http.StatusNotFound, gin.H{"error": "订单不存在"})
			return
		}
		if strings.Contains(err.Error(), "invalid order status") {
			c.JSON(http.StatusConflict, gin.H{"error": "订单状态异常"})
			return
		}
		logger.Error("manual payment callback failed", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "处理失败"})
		return
	}

	logger.Info("manual payment completed", "order_no", req.OrderNo, "paid_until", paidUntil)
	c.JSON(http.StatusOK, gin.H{"success": true, "paid_until": paidUntil})
}

// CloseOrder allows the user to close their own pending order.
func CloseOrder(c *gin.Context) {
	openid := c.GetString("openid")
	ctx := context.Background()
	orderNo := c.Param("order_no")
	if orderNo == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少订单号"})
		return
	}

	var userID int
	if err := db.Pool.QueryRow(ctx, `SELECT id FROM users WHERE openid = $1`, openid).Scan(&userID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "用户不存在"})
		return
	}

	tag, err := db.Pool.Exec(ctx, `
UPDATE payment_orders SET status = 'closed'
WHERE order_no = $1 AND user_id = $2 AND status = 'pending'
`, orderNo, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "关闭订单失败"})
		return
	}
	if tag.RowsAffected() == 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "订单不可关闭或不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "status": "closed"})
}

func GetSubscription(c *gin.Context) {
	openid := c.GetString("openid")
	ctx := context.Background()

	var paidUntil *time.Time
	err := db.Pool.QueryRow(ctx, `SELECT paid_until FROM users WHERE openid = $1`, openid).Scan(&paidUntil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
		return
	}

	isActive := paidUntil != nil && paidUntil.After(time.Now())
	result := gin.H{"is_active": isActive}
	if paidUntil != nil {
		result["paid_until"] = paidUntil
	}

	var userID int
	if err := db.Pool.QueryRow(ctx, `SELECT id FROM users WHERE openid = $1`, openid).Scan(&userID); err == nil {
		rows, err := db.Pool.Query(ctx, `
SELECT s.id, p.name, s.starts_at, s.expires_at, s.status
FROM subscriptions s JOIN plans p ON s.plan_id = p.id
WHERE s.user_id = $1 ORDER BY s.created_at DESC LIMIT 10
`, userID)
		if err == nil {
			defer rows.Close()
			var history []gin.H
			for rows.Next() {
				var id int
				var name, status string
				var startsAt, expiresAt time.Time
				if err := rows.Scan(&id, &name, &startsAt, &expiresAt, &status); err == nil {
					history = append(history, gin.H{
						"id": id, "plan": name, "starts_at": startsAt, "expires_at": expiresAt, "status": status,
					})
				}
			}
			result["history"] = history
		}
	}

	c.JSON(http.StatusOK, result)
}

func ListOrders(c *gin.Context) {
	openid := c.GetString("openid")
	ctx := context.Background()

	var userID int
	if err := db.Pool.QueryRow(ctx, `SELECT id FROM users WHERE openid = $1`, openid).Scan(&userID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "用户不存在"})
		return
	}

	rows, err := db.Pool.Query(ctx, `
SELECT o.id, o.order_no, o.amount_cents, o.status, o.created_at, o.paid_at, p.name
FROM payment_orders o JOIN plans p ON o.plan_id = p.id
WHERE o.user_id = $1 ORDER BY o.created_at DESC LIMIT 50
`, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
		return
	}
	defer rows.Close()

	var orders []gin.H
	for rows.Next() {
		var id, amountCents int
		var orderNo, status, planName string
		var createdAt time.Time
		var paidAt *time.Time
		if err := rows.Scan(&id, &orderNo, &amountCents, &status, &createdAt, &paidAt, &planName); err == nil {
			order := gin.H{
				"id": id, "order_no": orderNo, "amount_cents": amountCents,
				"status": status, "created_at": createdAt, "plan": planName,
			}
			if paidAt != nil {
				order["paid_at"] = paidAt
			}
			orders = append(orders, order)
		}
	}
	if orders == nil {
		orders = []gin.H{}
	}
	c.JSON(http.StatusOK, gin.H{"orders": orders})
}

var _ pgx.Tx
