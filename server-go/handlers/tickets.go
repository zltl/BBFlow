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

type CreateTicketRequest struct {
	Subject string `json:"subject" binding:"required"`
	Content string `json:"content" binding:"required"`
}

type ReplyTicketRequest struct {
	Content string `json:"content" binding:"required"`
}

// CreateTicket creates a new support ticket
func CreateTicket(c *gin.Context) {
	log := logging.FromGin(c)
	openid := c.GetString("openid")
	if openid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	var req CreateTicketRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	ctx := context.Background()
	tx, err := db.Pool.Begin(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create ticket"})
		return
	}
	defer tx.Rollback(ctx)

	var ticketID int
	err = tx.QueryRow(ctx,
		`INSERT INTO support_tickets (user_id, subject) VALUES ($1, $2) RETURNING id`,
		openid, req.Subject).Scan(&ticketID)
	if err != nil {
		log.Error("failed to create ticket", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create ticket"})
		return
	}

	_, err = tx.Exec(ctx,
		`INSERT INTO ticket_messages (ticket_id, sender_type, content) VALUES ($1, 'user', $2)`,
		ticketID, req.Content)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save message"})
		return
	}

	tx.Commit(ctx)
	c.JSON(http.StatusOK, gin.H{"id": ticketID, "message": "工单已提交"})
}

// ListTickets lists user's support tickets
func ListTickets(c *gin.Context) {
	openid := c.GetString("openid")
	if openid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	rows, err := db.Pool.Query(context.Background(),
		`SELECT id, subject, status, priority, created_at, updated_at
		 FROM support_tickets WHERE user_id = $1 ORDER BY updated_at DESC`, openid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to query tickets"})
		return
	}
	defer rows.Close()

	type ticket struct {
		ID        int       `json:"id"`
		Subject   string    `json:"subject"`
		Status    string    `json:"status"`
		Priority  string    `json:"priority"`
		CreatedAt time.Time `json:"created_at"`
		UpdatedAt time.Time `json:"updated_at"`
	}

	var tickets []ticket
	for rows.Next() {
		var t ticket
		rows.Scan(&t.ID, &t.Subject, &t.Status, &t.Priority, &t.CreatedAt, &t.UpdatedAt)
		tickets = append(tickets, t)
	}

	c.JSON(http.StatusOK, gin.H{"data": tickets})
}

// GetTicketMessages returns messages for a specific ticket
func GetTicketMessages(c *gin.Context) {
	openid := c.GetString("openid")
	if openid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	ticketID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ticket ID"})
		return
	}

	// Verify ownership
	var owner string
	err = db.Pool.QueryRow(context.Background(),
		`SELECT user_id FROM support_tickets WHERE id = $1`, ticketID).Scan(&owner)
	if err != nil || owner != openid {
		c.JSON(http.StatusForbidden, gin.H{"error": "Not authorized"})
		return
	}

	rows, err := db.Pool.Query(context.Background(),
		`SELECT id, sender_type, content, created_at
		 FROM ticket_messages WHERE ticket_id = $1 ORDER BY created_at ASC`, ticketID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to query messages"})
		return
	}
	defer rows.Close()

	type message struct {
		ID         int       `json:"id"`
		SenderType string    `json:"sender_type"`
		Content    string    `json:"content"`
		CreatedAt  time.Time `json:"created_at"`
	}

	var messages []message
	for rows.Next() {
		var m message
		rows.Scan(&m.ID, &m.SenderType, &m.Content, &m.CreatedAt)
		messages = append(messages, m)
	}

	c.JSON(http.StatusOK, gin.H{"data": messages})
}

// ReplyToTicket adds a user message to a ticket
func ReplyToTicket(c *gin.Context) {
	openid := c.GetString("openid")
	if openid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	ticketID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ticket ID"})
		return
	}

	var req ReplyTicketRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	// Verify ownership
	var owner string
	err = db.Pool.QueryRow(context.Background(),
		`SELECT user_id FROM support_tickets WHERE id = $1`, ticketID).Scan(&owner)
	if err != nil || owner != openid {
		c.JSON(http.StatusForbidden, gin.H{"error": "Not authorized"})
		return
	}

	ctx := context.Background()
	_, err = db.Pool.Exec(ctx,
		`INSERT INTO ticket_messages (ticket_id, sender_type, content) VALUES ($1, 'user', $2)`,
		ticketID, req.Content)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to send message"})
		return
	}

	// Reopen if closed
	db.Pool.Exec(ctx,
		`UPDATE support_tickets SET status = 'open', updated_at = $1 WHERE id = $2 AND status = 'closed'`,
		time.Now(), ticketID)

	c.JSON(http.StatusOK, gin.H{"message": "回复已发送"})
}

// --- Admin ticket endpoints ---

// AdminListTickets lists all tickets (admin only)
func AdminListTickets(c *gin.Context) {
	status := c.DefaultQuery("status", "")
	ctx := context.Background()

	query := `SELECT st.id, st.user_id, st.subject, st.status, st.priority, st.created_at, st.updated_at
	          FROM support_tickets st`
	args := []interface{}{}
	if status != "" {
		query += ` WHERE st.status = $1`
		args = append(args, status)
	}
	query += ` ORDER BY st.updated_at DESC LIMIT 100`

	rows, err := db.Pool.Query(ctx, query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to query tickets"})
		return
	}
	defer rows.Close()

	type adminTicket struct {
		ID        int       `json:"id"`
		UserID    string    `json:"user_id"`
		Subject   string    `json:"subject"`
		Status    string    `json:"status"`
		Priority  string    `json:"priority"`
		CreatedAt time.Time `json:"created_at"`
		UpdatedAt time.Time `json:"updated_at"`
	}

	var tickets []adminTicket
	for rows.Next() {
		var t adminTicket
		rows.Scan(&t.ID, &t.UserID, &t.Subject, &t.Status, &t.Priority, &t.CreatedAt, &t.UpdatedAt)
		tickets = append(tickets, t)
	}

	c.JSON(http.StatusOK, gin.H{"data": tickets})
}

// AdminReplyTicket allows admin to reply to a ticket
func AdminReplyTicket(c *gin.Context) {
	ticketID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ticket ID"})
		return
	}

	var req ReplyTicketRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	ctx := context.Background()
	_, err = db.Pool.Exec(ctx,
		`INSERT INTO ticket_messages (ticket_id, sender_type, content) VALUES ($1, 'admin', $2)`,
		ticketID, req.Content)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to send reply"})
		return
	}

	db.Pool.Exec(ctx,
		`UPDATE support_tickets SET updated_at = $1 WHERE id = $2`,
		time.Now(), ticketID)

	c.JSON(http.StatusOK, gin.H{"message": "回复已发送"})
}

// AdminCloseTicket closes a ticket
func AdminCloseTicket(c *gin.Context) {
	ticketID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ticket ID"})
		return
	}

	db.Pool.Exec(context.Background(),
		`UPDATE support_tickets SET status = 'closed', updated_at = $1 WHERE id = $2`,
		time.Now(), ticketID)

	c.JSON(http.StatusOK, gin.H{"message": "工单已关闭"})
}

// AdminSearchUsers searches users (admin)
func AdminSearchUsers(c *gin.Context) {
	query := c.Query("q")
	if query == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Missing search query"})
		return
	}

	rows, err := db.Pool.Query(context.Background(),
		`SELECT openid, nickname, COALESCE(is_admin, false), paid_until, created_at
		 FROM users WHERE openid ILIKE $1 OR nickname ILIKE $1
		 ORDER BY created_at DESC LIMIT 50`,
		"%"+query+"%")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Search failed"})
		return
	}
	defer rows.Close()

	type userResult struct {
		OpenID    string     `json:"openid"`
		Nickname  *string    `json:"nickname"`
		IsAdmin   bool       `json:"is_admin"`
		PaidUntil *time.Time `json:"paid_until"`
		CreatedAt time.Time  `json:"created_at"`
	}

	var users []userResult
	for rows.Next() {
		var u userResult
		rows.Scan(&u.OpenID, &u.Nickname, &u.IsAdmin, &u.PaidUntil, &u.CreatedAt)
		users = append(users, u)
	}

	c.JSON(http.StatusOK, gin.H{"data": users})
}

// AdminGetAnalytics returns basic analytics
func AdminGetAnalytics(c *gin.Context) {
	ctx := context.Background()

	var totalUsers, paidUsers, totalRecords, totalOCR int
	db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM users`).Scan(&totalUsers)
	db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM users WHERE paid_until > NOW()`).Scan(&paidUsers)
	db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM bp_records`).Scan(&totalRecords)
	db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM ocr_logs`).Scan(&totalOCR)

	// Recent signups (last 7 days)
	var recentSignups int
	db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM users WHERE created_at >= NOW() - INTERVAL '7 days'`).Scan(&recentSignups)

	// Active users (last 7 days with records)
	var activeUsers int
	db.Pool.QueryRow(ctx,
		`SELECT COUNT(DISTINCT user_id) FROM bp_records WHERE created_at >= NOW() - INTERVAL '7 days'`).Scan(&activeUsers)

	c.JSON(http.StatusOK, gin.H{
		"total_users":    totalUsers,
		"paid_users":     paidUsers,
		"total_records":  totalRecords,
		"total_ocr":      totalOCR,
		"recent_signups": recentSignups,
		"active_users":   activeUsers,
	})
}
