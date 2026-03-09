package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"bbflow-server/config"
	"bbflow-server/db"
	"bbflow-server/handlers"
	"bbflow-server/logging"
	"bbflow-server/middleware"

	"github.com/gin-gonic/gin"
)

func main() {
	// Load configuration
	config.Load()

	// Initialize structured logging
	logging.Init(config.AppConfig.LogLevel)

	// Initialize database
	if err := db.Init(); err != nil {
		slog.Error("failed to initialize database", "error", err)
		panic(err)
	}
	defer db.Close()

	// Setup Gin
	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(middleware.CORS())
	r.Use(middleware.RequestID())
	r.Use(middleware.RequestLogging())

	// Health check
	r.GET("/", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok", "message": "BBFlow Server is running"})
	})
	r.GET("/health", func(c *gin.Context) {
		status := "ok"
		dbOk := true
		if err := db.Pool.Ping(context.Background()); err != nil {
			status = "degraded"
			dbOk = false
		}
		c.JSON(200, gin.H{"status": status, "database": dbOk})
	})

	// Serve static files (admin page)
	r.Static("/static", "./static")

	// Auth routes
	api := r.Group("/api")
	{
		auth := api.Group("/auth")
		{
			auth.POST("/login", handlers.Login)
			auth.POST("/authorize", middleware.AuthMiddleware(), handlers.Authorize)
			auth.GET("/me", middleware.AuthMiddleware(), handlers.GetUserInfo)
		}

		// Records routes (require auth)
		records := api.Group("/records")
		records.Use(middleware.AuthMiddleware())
		{
			records.GET("/", middleware.HistoryLimiter(), handlers.GetRecords)
			records.POST("/", middleware.RecordLimiter(), middleware.Idempotency(), handlers.CreateRecord)
			records.DELETE("/:id", middleware.RecordLimiter(), handlers.DeleteRecord)
		}

		// OCR routes (require auth)
		ocr := api.Group("/ocr")
		ocr.Use(middleware.AuthMiddleware())
		{
			ocr.POST("/recognize", middleware.RecordLimiter(), handlers.OCRRecognize)
			ocr.POST("/verify", handlers.OCRVerify)
		}

		// Share routes
		share := api.Group("/share")
		{
			share.POST("/generate-token", middleware.AuthMiddleware(), middleware.ShareGenLimiter(), handlers.GenerateShareToken)
			share.GET("/list", middleware.AuthMiddleware(), handlers.ListShareTokens)
			share.POST("/revoke/:token", middleware.AuthMiddleware(), handlers.RevokeShareToken)
			share.GET("/view/:token", middleware.ShareViewLimiter(), handlers.ViewShareData)
			share.GET("/html/:token", middleware.ShareViewLimiter(), handlers.ViewShareHTML)
		}

		// Health insights
		api.GET("/insights", middleware.AuthMiddleware(), handlers.GetHealthInsights)

		// Medication management
		meds := api.Group("/medications")
		meds.Use(middleware.AuthMiddleware())
		{
			meds.GET("/", handlers.ListMedications)
			meds.POST("/", handlers.CreateMedication)
			meds.PUT("/:id", handlers.UpdateMedication)
			meds.DELETE("/:id", handlers.DeleteMedication)
			meds.POST("/log", handlers.LogMedication)
			meds.GET("/adherence", handlers.GetMedicationAdherence)
		}

		// Data export & account management
		api.GET("/export/json", middleware.AuthMiddleware(), handlers.ExportUserData)
		api.GET("/export/csv", middleware.AuthMiddleware(), handlers.ExportUserDataCSV)
		api.DELETE("/account", middleware.AuthMiddleware(), handlers.DeleteAccount)

		// Support tickets
		tickets := api.Group("/tickets")
		tickets.Use(middleware.AuthMiddleware())
		{
			tickets.POST("/", handlers.CreateTicket)
			tickets.GET("/", handlers.ListTickets)
			tickets.GET("/:id/messages", handlers.GetTicketMessages)
			tickets.POST("/:id/reply", handlers.ReplyToTicket)
		}

		// Payment & subscription
		api.GET("/plans", handlers.ListPlans)
		payment := api.Group("/payment")
		payment.Use(middleware.AuthMiddleware())
		{
			payment.POST("/order", middleware.Idempotency(), handlers.CreateOrder)
			payment.GET("/subscription", handlers.GetSubscription)
			payment.GET("/orders", handlers.ListOrders)
		}
		api.POST("/payment/callback", handlers.PaymentCallback)

		// Invite routes (distribution system)
		invite := api.Group("/invite")
		invite.Use(middleware.AuthMiddleware())
		{
			invite.POST("/create", handlers.CreateInviteLink)
			invite.GET("/list", handlers.ListInviteLinks)
			invite.POST("/use", handlers.UseInviteLink)
		}

		// Feedback routes (paid users only)
		api.POST("/feedback", middleware.AuthMiddleware(), handlers.PostFeedback)

		// Admin routes (require login + is_admin)
		admin := api.Group("/admin")
		admin.Use(middleware.AuthMiddleware())
		admin.Use(handlers.AdminAuthMiddleware())
		{
			admin.POST("/activation-links", handlers.GenerateActivationLinks)
			admin.GET("/activation-links", handlers.ListActivationLinks)
			admin.DELETE("/activation-links/:code", handlers.DeleteActivationLink)
			admin.GET("/tickets", handlers.AdminListTickets)
			admin.POST("/tickets/:id/reply", handlers.AdminReplyTicket)
			admin.POST("/tickets/:id/close", handlers.AdminCloseTicket)
			admin.GET("/users/search", handlers.AdminSearchUsers)
			admin.GET("/analytics", handlers.AdminGetAnalytics)
		}
	}

	// Also mount share routes at root /share for cleaner HTML links
	r.GET("/share/html/:token", middleware.ShareViewLimiter(), handlers.ViewShareHTML)
	r.GET("/share/view/:token", middleware.ShareViewLimiter(), handlers.ViewShareData)

	// Start server with graceful shutdown
	addr := fmt.Sprintf(":%d", config.AppConfig.Port)
	srv := &http.Server{Addr: addr, Handler: r}

	go func() {
		slog.Info("server starting", "addr", addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "error", err)
			os.Exit(1)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	slog.Info("shutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		slog.Error("server forced to shutdown", "error", err)
	}
	slog.Info("server stopped")
}
