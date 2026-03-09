package main

import (
	"context"
	"fmt"
	"log"
	"math/rand"
	"time"
	"os"

	"bbflow-server/config"
	"bbflow-server/db"
)

func main() {
	config.Load()
	if err := db.Init(); err != nil {
		log.Fatal("Failed to init db:", err)
	}
	defer db.Close()

	openid := os.Args[0]
	
	// Seed random
	rand.Seed(time.Now().UnixNano())

	now := time.Now()
	ctx := context.Background()

	// Generate data for last 30 days
	for i := 29; i >= 0; i-- {
		day := now.AddDate(0, 0, -i)
		
		// Morning record (6-9 AM)
		morningTime := time.Date(day.Year(), day.Month(), day.Day(), 6+rand.Intn(3), rand.Intn(60), 0, 0, day.Location())
		insertRecord(ctx, openid, morningTime)
		
		// Sometimes add noon record (11 AM - 2 PM) - 30% chance
		if rand.Float32() < 0.3 {
			noonTime := time.Date(day.Year(), day.Month(), day.Day(), 11+rand.Intn(3), rand.Intn(60), 0, 0, day.Location())
			insertRecord(ctx, openid, noonTime)
		}
		
		// Evening record (6-9 PM) - 80% chance
		if rand.Float32() < 0.8 {
			eveningTime := time.Date(day.Year(), day.Month(), day.Day(), 18+rand.Intn(3), rand.Intn(60), 0, 0, day.Location())
			insertRecord(ctx, openid, eveningTime)
		}
	}

	log.Println("Seed data completed!")
}

func insertRecord(ctx context.Context, openid string, measuredAt time.Time) {
	// Generate realistic blood pressure values
	// Base: systolic 115-125, diastolic 70-80, heart rate 65-75
	// Add some variation and occasional high readings
	
	baseSys := 115 + rand.Intn(10)
	baseDia := 70 + rand.Intn(10)
	baseHR := 65 + rand.Intn(10)
	
	// 20% chance of slightly elevated
	if rand.Float32() < 0.2 {
		baseSys += 15 + rand.Intn(15) // 130-145
		baseDia += 10 + rand.Intn(10) // 80-90
	}
	
	// 5% chance of high reading
	if rand.Float32() < 0.05 {
		baseSys += 30 + rand.Intn(20) // 145-165+
		baseDia += 15 + rand.Intn(15) // 85-100
	}

	_, err := db.Pool.Exec(ctx,
		`INSERT INTO bp_records (user_id, systolic, diastolic, heart_rate, measured_at, tags, note)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		openid, baseSys, baseDia, baseHR, measuredAt, "[]", "")
	
	if err != nil {
		log.Printf("Failed to insert record: %v", err)
	} else {
		fmt.Printf("Inserted: %s - %d/%d HR:%d\n", measuredAt.Format("2006-01-02 15:04"), baseSys, baseDia, baseHR)
	}
}
