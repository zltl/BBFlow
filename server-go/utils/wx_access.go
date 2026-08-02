package utils

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"bbflow-server/config"
)

var (
	wxTokenMu     sync.Mutex
	wxAccessToken string
	wxTokenExpiry time.Time
)

// GetWeChatAccessToken returns a cached client_credential access token.
func GetWeChatAccessToken() (string, error) {
	wxTokenMu.Lock()
	defer wxTokenMu.Unlock()

	if wxAccessToken != "" && time.Now().Before(wxTokenExpiry) {
		return wxAccessToken, nil
	}

	appID := config.AppConfig.Wx.AppID
	secret := config.AppConfig.Wx.Secret
	if appID == "" || secret == "" {
		return "", fmt.Errorf("wechat app credentials not configured")
	}

	url := fmt.Sprintf(
		"https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=%s&secret=%s",
		appID, secret,
	)
	resp, err := http.Get(url)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	var result struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
		ErrCode     int    `json:"errcode"`
		ErrMsg      string `json:"errmsg"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return "", err
	}
	if result.ErrCode != 0 || result.AccessToken == "" {
		return "", fmt.Errorf("wechat token error: %d %s", result.ErrCode, result.ErrMsg)
	}

	wxAccessToken = result.AccessToken
	wxTokenExpiry = time.Now().Add(time.Duration(result.ExpiresIn-60) * time.Second)
	return wxAccessToken, nil
}

// SendSubscribeMessage sends a WeChat mini-program subscribe message.
func SendSubscribeMessage(openid, templateID, page string, data map[string]map[string]string) error {
	token, err := GetWeChatAccessToken()
	if err != nil {
		return err
	}

	payload := map[string]interface{}{
		"touser":      openid,
		"template_id": templateID,
		"page":        page,
		"data":        data,
	}
	raw, _ := json.Marshal(payload)
	apiURL := fmt.Sprintf("https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=%s", token)
	resp, err := http.Post(apiURL, "application/json", bytes.NewReader(raw))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	var result struct {
		ErrCode int    `json:"errcode"`
		ErrMsg  string `json:"errmsg"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return err
	}
	if result.ErrCode != 0 {
		return fmt.Errorf("subscribe send failed: %d %s", result.ErrCode, result.ErrMsg)
	}
	return nil
}
