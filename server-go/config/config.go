package config

import (
	"os"
	"path/filepath"
	"strconv"

	"github.com/joho/godotenv"
)

type WxConfig struct {
	AppID  string
	Secret string
}

type DBConfig struct {
	Host     string
	Port     int
	Database string
	User     string
	Password string
}

type BaiduConfig struct {
	APIKey    string
	SecretKey string
}

type OSSConfig struct {
	Region          string
	AccessKeyID     string
	AccessKeySecret string
	Bucket          string
}

type LLMConfig struct {
	APIKey  string
	BaseURL string
	Model   string
}

type Config struct {
	Port      int
	Wx        WxConfig
	DB        DBConfig
	JWTSecret string
	Baidu     BaiduConfig
	OSS       OSSConfig
	LLM       LLMConfig
}

var AppConfig Config

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if i, err := strconv.Atoi(value); err == nil {
			return i
		}
	}
	return defaultValue
}

func Load() {
	// Load .secret.dev from project root
	envPath := filepath.Join("..", ".secret.dev")
	_ = godotenv.Load(envPath)

	AppConfig = Config{
		Port: getEnvInt("PORT", 3000),
		Wx: WxConfig{
			AppID:  getEnv("WC_APP_ID", ""),
			Secret: getEnv("WC_APP_SECRET", ""),
		},
		DB: DBConfig{
			Host:     getEnv("PG_HOST", "localhost"),
			Port:     getEnvInt("PG_PORT", 5432),
			Database: getEnv("PG_DBNAME", "bbflow"),
			User:     getEnv("PG_USER", "postgres"),
			Password: getEnv("PG_PASSWORD", ""),
		},
		JWTSecret: getEnv("JWT_SECRET", "default_secret_key_for_dev"),
		Baidu: BaiduConfig{
			APIKey:    getEnv("BAIDU_OCR_API_KEY", ""),
			SecretKey: getEnv("BAIDU_OCR_SECRET_KEY", ""),
		},
		OSS: OSSConfig{
			Region:          getEnv("ALIYUN_OSS_BUCKET_REGION", "oss-cn-hangzhou"),
			AccessKeyID:     getEnv("ALIYUN_OSS_BUCKET_ACCESS_KEY_ID", ""),
			AccessKeySecret: getEnv("ALIYUN_OSS_BUCKET_ACCESS_KEY_SECRET", ""),
			Bucket:          getEnv("ALIYUN_OSS_BUCKET_NAME", ""),
		},
		LLM: LLMConfig{
			APIKey:  getEnv("LLM_API_KEY", ""),
			BaseURL: getEnv("LLM_BASE_URL", "https://api.openai.com/v1"),
			Model:   getEnv("LLM_MODEL", "gpt-4o"),
		},
	}
}
