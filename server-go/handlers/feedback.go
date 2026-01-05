package handlers

import (
    "context"
    "encoding/json"
    "net/http"

    "bbflow-server/db"

    "github.com/gin-gonic/gin"
)

type FeedbackRequest struct {
    Type    string `json:"type"` // "feature" or "feedback"
    Content string `json:"content"`
    Contact string `json:"contact"`
}

func PostFeedback(c *gin.Context) {
    var req FeedbackRequest
    if err := c.ShouldBindJSON(&req); err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
        return
    }

    openidIF, exists := c.Get("openid")
    if !exists {
        c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
        return
    }
    openid := openidIF.(string)

    // Check if user is authorized (entered auth code)
    var rlConfig sqlNullString
    row := db.Pool.QueryRow(context.Background(), `SELECT rate_limit_config FROM users WHERE openid = $1`, openid)
    if err := row.Scan(&rlConfig); err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to query user"})
        return
    }

    // If no config, reject
    if rlConfig.Valid {
        var cfg map[string]interface{}
        _ = json.Unmarshal([]byte(rlConfig.String), &cfg)
        if authorized, ok := cfg["authorized"].(bool); !ok || !authorized {
            c.JSON(http.StatusForbidden, gin.H{"error": "仅已授权用户可以提交反馈"})
            return
        }
    } else {
        c.JSON(http.StatusForbidden, gin.H{"error": "仅已授权用户可以提交反馈"})
        return
    }

    // Insert feedback
    _, err := db.Pool.Exec(context.Background(), `
        INSERT INTO feedbacks (user_id, type, content, contact) VALUES ($1, $2, $3, $4)
    `, openid, req.Type, req.Content, req.Contact)
    if err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save feedback"})
        return
    }

    c.JSON(http.StatusOK, gin.H{"message": "提交成功"})
}

// sqlNullString is a tiny helper to scan nullable text
type sqlNullString struct {
    String string
    Valid  bool
}

func (s *sqlNullString) Scan(src interface{}) error {
    if src == nil {
        s.String, s.Valid = "", false
        return nil
    }
    switch v := src.(type) {
    case string:
        s.String, s.Valid = v, true
    case []byte:
        s.String, s.Valid = string(v), true
    default:
        s.String, s.Valid = "", false
    }
    return nil
}
