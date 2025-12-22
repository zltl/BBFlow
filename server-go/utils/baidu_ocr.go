package utils

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"bbflow-server/config"
)

var (
	cachedToken   string
	tokenExpireAt time.Time
	tokenMu       sync.Mutex
)

func getAccessToken() (string, error) {
	tokenMu.Lock()
	defer tokenMu.Unlock()

	if cachedToken != "" && time.Now().Before(tokenExpireAt) {
		return cachedToken, nil
	}

	cfg := config.AppConfig.Baidu
	if cfg.APIKey == "" || cfg.SecretKey == "" {
		return "", fmt.Errorf("Baidu API Key or Secret Key not configured")
	}

	apiURL := fmt.Sprintf("https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=%s&client_secret=%s",
		cfg.APIKey, cfg.SecretKey)

	resp, err := http.Post(apiURL, "", nil)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var result struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}

	if result.AccessToken == "" {
		return "", fmt.Errorf("failed to get access token from Baidu")
	}

	cachedToken = result.AccessToken
	tokenExpireAt = time.Now().Add(time.Duration(result.ExpiresIn-60) * time.Second)

	return cachedToken, nil
}

type OCRResult struct {
	Words    string `json:"words"`
	Location struct {
		Top    int `json:"top"`
		Left   int `json:"left"`
		Width  int `json:"width"`
		Height int `json:"height"`
	} `json:"location"`
}

func RecognizeImage(imageData []byte) ([]OCRResult, error) {
	token, err := getAccessToken()
	if err != nil {
		return nil, err
	}

	apiURL := fmt.Sprintf("https://aip.baidubce.com/rest/2.0/ocr/v1/meter?access_token=%s", token)

	imageBase64 := base64.StdEncoding.EncodeToString(imageData)
	data := url.Values{}
	data.Set("image", imageBase64)

	resp, err := http.Post(apiURL, "application/x-www-form-urlencoded", strings.NewReader(data.Encode()))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var result struct {
		WordsResult []OCRResult `json:"words_result"`
		ErrorCode   int         `json:"error_code"`
		ErrorMsg    string      `json:"error_msg"`
	}

	if err := json.Unmarshal(body, &result); err != nil {
		return nil, err
	}

	if result.ErrorCode != 0 {
		return nil, fmt.Errorf("Baidu OCR Error: %s", result.ErrorMsg)
	}

	return result.WordsResult, nil
}
