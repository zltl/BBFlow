package handlers

import (
"context"
"fmt"
"net/http"
"time"

"bbflow-server/db"
"bbflow-server/logging"

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

// Get user numeric ID
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

// In production, call WeChat Pay API here to get prepay_id
c.JSON(http.StatusOK, gin.H{
"order_id":     orderID,
"order_no":     orderNo,
"amount_cents": plan.PriceCents,
"plan_name":    plan.Name,
"status":       "pending",
"message":      "订单已创建，请完成支付",
})
}

// PaymentCallback handles payment notifications (WeChat Pay webhook or admin trigger)
func PaymentCallback(c *gin.Context) {
logger := logging.FromGin(c)
ctx := context.Background()

var req struct {
OrderNo       string `json:"order_no" binding:"required"`
TradeNo       string `json:"trade_no"`
PaymentMethod string `json:"payment_method"`
}
if err := c.ShouldBindJSON(&req); err != nil {
c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
return
}

tx, err := db.Pool.Begin(ctx)
if err != nil {
logger.Error("failed to begin transaction", "error", err)
c.JSON(http.StatusInternalServerError, gin.H{"error": "处理失败"})
return
}
defer tx.Rollback(ctx)

var orderID, userID, planID, amountCents int
var status string
err = tx.QueryRow(ctx, `
SELECT id, user_id, plan_id, amount_cents, status FROM payment_orders WHERE order_no = $1
`, req.OrderNo).Scan(&orderID, &userID, &planID, &amountCents, &status)
if err != nil {
c.JSON(http.StatusNotFound, gin.H{"error": "订单不存在"})
return
}
if status != "pending" {
c.JSON(http.StatusConflict, gin.H{"error": "订单状态异常", "status": status})
return
}

var durationDays int
err = tx.QueryRow(ctx, `SELECT duration_days FROM plans WHERE id = $1`, planID).Scan(&durationDays)
if err != nil {
logger.Error("failed to get plan", "error", err)
c.JSON(http.StatusInternalServerError, gin.H{"error": "处理失败"})
return
}

_, err = tx.Exec(ctx, `
UPDATE payment_orders SET status = 'paid', trade_no = $1, payment_method = $2, paid_at = NOW() WHERE id = $3
`, req.TradeNo, req.PaymentMethod, orderID)
if err != nil {
logger.Error("failed to update order", "error", err)
c.JSON(http.StatusInternalServerError, gin.H{"error": "处理失败"})
return
}

// Extend subscription: if existing paid_until is in the future, extend from that date
paidUntil := time.Now().AddDate(0, 0, durationDays)
var existingPaidUntil *time.Time
err = tx.QueryRow(ctx, `SELECT paid_until FROM users WHERE id = $1`, userID).Scan(&existingPaidUntil)
if err == nil && existingPaidUntil != nil && existingPaidUntil.After(time.Now()) {
paidUntil = existingPaidUntil.AddDate(0, 0, durationDays)
}

_, err = tx.Exec(ctx, `UPDATE users SET paid_until = $1 WHERE id = $2`, paidUntil, userID)
if err != nil {
logger.Error("failed to update user subscription", "error", err)
c.JSON(http.StatusInternalServerError, gin.H{"error": "处理失败"})
return
}

_, err = tx.Exec(ctx, `
INSERT INTO subscriptions (user_id, plan_id, order_id, starts_at, expires_at, status, created_at)
VALUES ($1, $2, $3, NOW(), $4, 'active', NOW())
`, userID, planID, orderID, paidUntil)
if err != nil {
logger.Error("failed to create subscription", "error", err)
c.JSON(http.StatusInternalServerError, gin.H{"error": "处理失败"})
return
}

if err := tx.Commit(ctx); err != nil {
logger.Error("failed to commit", "error", err)
c.JSON(http.StatusInternalServerError, gin.H{"error": "处理失败"})
return
}

logger.Info("payment completed", "order_id", orderID, "user_id", userID, "paid_until", paidUntil)
c.JSON(http.StatusOK, gin.H{"success": true, "paid_until": paidUntil})
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

// Get user ID for subscription history
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

// Ensure pgx is used (suppresses unused import if needed)
var _ pgx.Tx
