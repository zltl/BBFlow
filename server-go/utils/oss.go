package utils

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"path"
	"time"

	"bbflow-server/config"

	"github.com/aliyun/aliyun-oss-go-sdk/oss"
)

var ossClient *oss.Client
var ossBucket *oss.Bucket

func getOSSBucket() (*oss.Bucket, error) {
	if ossBucket != nil {
		return ossBucket, nil
	}

	cfg := config.AppConfig.OSS
	if cfg.AccessKeyID == "" || cfg.AccessKeySecret == "" || cfg.Bucket == "" {
		return nil, fmt.Errorf("OSS configuration is missing")
	}

	var err error
	endpoint := fmt.Sprintf("%s.aliyuncs.com", cfg.Region)
	ossClient, err = oss.New(endpoint, cfg.AccessKeyID, cfg.AccessKeySecret)
	if err != nil {
		return nil, err
	}

	ossBucket, err = ossClient.Bucket(cfg.Bucket)
	if err != nil {
		return nil, err
	}

	return ossBucket, nil
}

func UploadImageToOSS(data []byte, originalFilename string) (string, error) {
	bucket, err := getOSSBucket()
	if err != nil {
		return "", err
	}

	now := time.Now()
	year := now.Format("2006")
	month := now.Format("01")
	day := now.Format("02")

	ext := path.Ext(originalFilename)
	if ext == "" {
		ext = ".jpg"
	}

	randomBytes := make([]byte, 4)
	rand.Read(randomBytes)
	randomStr := hex.EncodeToString(randomBytes)

	objectName := fmt.Sprintf("ocr/%s/%s/%s/%d_%s%s", year, month, day, now.UnixMilli(), randomStr, ext)

	err = bucket.PutObject(objectName, bytes.NewReader(data))
	if err != nil {
		return "", err
	}

	return objectName, nil
}
