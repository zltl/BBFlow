package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"bbflow-server/config"
	"bbflow-server/db"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

type LoginRequest struct {
	Code     string   `json:"code"`
	UserInfo *UserInfo `json:"userInfo"`
}

type UserInfo struct {
	NickName  string `json:"nickName"`
	AvatarURL string `json:"avatarUrl"`
}

type WxResponse struct {
	OpenID     string `json:"openid"`
	SessionKey string `json:"session_key"`
	ErrCode    int    `json:"errcode"`
	ErrMsg     string `json:"errmsg"`
}

func Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	log.Println("----- Login Request Start -----")
	log.Println("Received code:", req.Code)

	if req.Code == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Missing code"})
		return
	}

	// Call WeChat API
	wxURL := fmt.Sprintf("https://api.weixin.qq.com/sns/jscode2session?appid=%s&secret=%s&js_code=%s&grant_type=authorization_code",
		config.AppConfig.Wx.AppID, config.AppConfig.Wx.Secret, req.Code)

	resp, err := http.Get(wxURL)
	if err != nil {
		log.Println("WeChat API Error:", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to call WeChat API"})
		return
	}
	defer resp.Body.Close()

	var wxResp WxResponse
	if err := json.NewDecoder(resp.Body).Decode(&wxResp); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to parse WeChat response"})
		return
	}

	if wxResp.ErrCode != 0 {
		log.Println("WeChat API Error:", wxResp)
		c.JSON(http.StatusBadRequest, gin.H{"error": "WeChat API Error", "details": wxResp})
		return
	}

	openid := wxResp.OpenID
	log.Println("Login successful. OpenID:", openid)

	// Save/Update user
	var nickname, avatarURL *string
	if req.UserInfo != nil {
		nickname = &req.UserInfo.NickName
		avatarURL = &req.UserInfo.AvatarURL
	}

	_, err = db.Pool.Exec(context.Background(), `
		INSERT INTO users (openid, nickname, avatar_url) 
		VALUES ($1, $2, $3)
		ON CONFLICT (openid) DO UPDATE 
		SET nickname = EXCLUDED.nickname, avatar_url = EXCLUDED.avatar_url
	`, openid, nickname, avatarURL)
	if err != nil {
		log.Println("Error saving user:", err)
	}

	// Generate JWT
	claims := jwt.MapClaims{
		"openid": openid,
		"exp":    time.Now().Add(7 * 24 * time.Hour).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenStr, err := token.SignedString([]byte(config.AppConfig.JWTSecret))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"openid":  openid,
		"token":   tokenStr,
		"message": "Login successful",
	})
}
