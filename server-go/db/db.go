package db

import (
	"context"
	"fmt"
	"log"

	"bbflow-server/config"

	"github.com/jackc/pgx/v5/pgxpool"
)

var Pool *pgxpool.Pool

func Init() error {
	cfg := config.AppConfig.DB
	connStr := fmt.Sprintf("postgres://%s:%s@%s:%d/%s",
		cfg.User, cfg.Password, cfg.Host, cfg.Port, cfg.Database)

	var err error
	Pool, err = pgxpool.New(context.Background(), connStr)
	if err != nil {
		return fmt.Errorf("unable to connect to database: %w", err)
	}

	if err := Pool.Ping(context.Background()); err != nil {
		return fmt.Errorf("unable to ping database: %w", err)
	}

	log.Println("Connected to PostgreSQL database")

	if err := initTables(); err != nil {
		return err
	}

	return nil
}

func initTables() error {
	ctx := context.Background()

	// Users table
	_, err := Pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS users (
			id SERIAL PRIMARY KEY,
			openid TEXT UNIQUE NOT NULL,
			nickname TEXT,
			avatar_url TEXT,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		);
	`)
	if err != nil {
		return fmt.Errorf("failed to create users table: %w", err)
	}

	// Blood pressure records table
	_, err = Pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS bp_records (
			id SERIAL PRIMARY KEY,
			user_id TEXT NOT NULL,
			systolic INTEGER NOT NULL,
			diastolic INTEGER NOT NULL,
			heart_rate INTEGER,
			measured_at TIMESTAMP NOT NULL,
			tags TEXT,
			note TEXT,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY(user_id) REFERENCES users(openid)
		);
	`)
	if err != nil {
		return fmt.Errorf("failed to create bp_records table: %w", err)
	}

	// OCR logs table
	_, err = Pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS ocr_logs (
			id SERIAL PRIMARY KEY,
			user_id TEXT NOT NULL,
			image_path TEXT,
			raw_result TEXT,
			parsed_result TEXT,
			status TEXT,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY(user_id) REFERENCES users(openid)
		);
	`)
	if err != nil {
		return fmt.Errorf("failed to create ocr_logs table: %w", err)
	}

	// Share tokens table
	_, err = Pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS share_tokens (
			token TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			time_range TEXT NOT NULL,
			share_future_data BOOLEAN DEFAULT FALSE,
			expires_at TIMESTAMP NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY(user_id) REFERENCES users(openid)
		);
	`)
	if err != nil {
		return fmt.Errorf("failed to create share_tokens table: %w", err)
	}

	// Add rate_limit_config column
	_, err = Pool.Exec(ctx, `
		ALTER TABLE users 
		ADD COLUMN IF NOT EXISTS rate_limit_config JSONB DEFAULT '{}';
	`)
	if err != nil {
		return fmt.Errorf("failed to add rate_limit_config column: %w", err)
	}

	log.Println("Database initialized successfully")
	return nil
}

func Close() {
	if Pool != nil {
		Pool.Close()
	}
}
