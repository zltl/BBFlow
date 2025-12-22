package main

import (
	"fmt"
	"log"
	"time"

	"bbflow-server/config"
	"bbflow-server/db"
	"bbflow-server/handlers"
	"bbflow-server/middleware"

	"github.com/gin-gonic/gin"
)

func main() {
	// Load configuration
	config.Load()

	// Initialize database
	if err := db.Init(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	// Setup Gin
	r := gin.Default()

	// Request logging middleware
	r.Use(func(c *gin.Context) {
		timestamp := time.Now().Format(time.RFC3339)
		log.Printf("[%s] %s %s", timestamp, c.Request.Method, c.Request.URL.Path)
		c.Next()
	})

	// Health check
	r.GET("/", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok", "message": "BBFlow Server is running"})
	})

	// Auth routes
	api := r.Group("/api")
	{
		auth := api.Group("/auth")
		{
			auth.POST("/login", handlers.Login)
		}

		// Records routes (require auth)
		records := api.Group("/records")
		records.Use(middleware.AuthMiddleware())
		{
			records.GET("/", middleware.HistoryLimiter(), handlers.GetRecords)
			records.POST("/", middleware.RecordLimiter(), handlers.CreateRecord)
			records.DELETE("/:id", middleware.RecordLimiter(), handlers.DeleteRecord)
		}

		// OCR routes (require auth)
		ocr := api.Group("/ocr")
		ocr.Use(middleware.AuthMiddleware())
		{
			ocr.POST("/recognize", middleware.RecordLimiter(), handlers.OCRRecognize)
		}

		// Share routes
		share := api.Group("/share")
		{
			share.POST("/generate-token", middleware.AuthMiddleware(), middleware.ShareGenLimiter(), handlers.GenerateShareToken)
			share.GET("/view/:token", middleware.ShareViewLimiter(), handlers.ViewShareData)
			share.GET("/html/:token", middleware.ShareViewLimiter(), handlers.ViewShareHTML)
		}
	}

	// Also mount share routes at root /share for cleaner HTML links
	r.GET("/share/html/:token", middleware.ShareViewLimiter(), handlers.ViewShareHTML)
	r.GET("/share/view/:token", middleware.ShareViewLimiter(), handlers.ViewShareData)

	// Start server
	addr := fmt.Sprintf(":%d", config.AppConfig.Port)
	log.Printf("Server is running on http://localhost%s", addr)
	if err := r.Run(addr); err != nil {
		log.Fatal("Failed to start server:", err)
	}
}
