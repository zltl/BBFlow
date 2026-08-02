package utils

import (
	"crypto/md5"
	"encoding/hex"
	"encoding/xml"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"sort"
	"strings"
	"time"
)

// WxPayNotify is the XML body from WeChat Pay v2 payment notification.
type WxPayNotify struct {
	XMLName       xml.Name `xml:"xml"`
	ReturnCode    string   `xml:"return_code"`
	ReturnMsg     string   `xml:"return_msg"`
	ResultCode    string   `xml:"result_code"`
	ErrCodeDes    string   `xml:"err_code_des"`
	AppID         string   `xml:"appid"`
	MchID         string   `xml:"mch_id"`
	NonceStr      string   `xml:"nonce_str"`
	Sign          string   `xml:"sign"`
	OpenID        string   `xml:"openid"`
	TradeType     string   `xml:"trade_type"`
	TotalFee      int      `xml:"total_fee"`
	TransactionID string   `xml:"transaction_id"`
	OutTradeNo    string   `xml:"out_trade_no"`
	TimeEnd       string   `xml:"time_end"`
}

type unifiedOrderResp struct {
	XMLName    xml.Name `xml:"xml"`
	ReturnCode string   `xml:"return_code"`
	ReturnMsg  string   `xml:"return_msg"`
	ResultCode string   `xml:"result_code"`
	ErrCodeDes string   `xml:"err_code_des"`
	PrepayID   string   `xml:"prepay_id"`
	NonceStr   string   `xml:"nonce_str"`
	Sign       string   `xml:"sign"`
}

func RandomNonceStr(n int) string {
	const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	b := make([]byte, n)
	for i := range b {
		b[i] = letters[rand.Intn(len(letters))]
	}
	return string(b)
}

// SignWxPayMap builds WeChat Pay v2 MD5 sign (uppercase hex).
func SignWxPayMap(params map[string]string, apiKey string) string {
	keys := make([]string, 0, len(params))
	for k, v := range params {
		if k == "sign" || v == "" {
			continue
		}
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys)+1)
	for _, k := range keys {
		parts = append(parts, k+"="+params[k])
	}
	parts = append(parts, "key="+apiKey)
	sum := md5.Sum([]byte(strings.Join(parts, "&")))
	return strings.ToUpper(hex.EncodeToString(sum[:]))
}

func mapToXML(params map[string]string) string {
	var b strings.Builder
	b.WriteString("<xml>")
	for k, v := range params {
		b.WriteString("<")
		b.WriteString(k)
		b.WriteString("><![CDATA[")
		b.WriteString(v)
		b.WriteString("]]></")
		b.WriteString(k)
		b.WriteString(">")
	}
	b.WriteString("</xml>")
	return b.String()
}

// UnifiedOrderJSAPI creates a WeChat Pay JSAPI prepay_id.
func UnifiedOrderJSAPI(appID, mchID, apiKey, openid, orderNo, description, notifyURL string, totalFeeCents int, clientIP string) (prepayID string, err error) {
	nonce := RandomNonceStr(32)
	params := map[string]string{
		"appid":            appID,
		"mch_id":           mchID,
		"nonce_str":        nonce,
		"body":             description,
		"out_trade_no":     orderNo,
		"total_fee":        fmt.Sprintf("%d", totalFeeCents),
		"spbill_create_ip": clientIP,
		"notify_url":       notifyURL,
		"trade_type":       "JSAPI",
		"openid":           openid,
	}
	params["sign"] = SignWxPayMap(params, apiKey)

	req, err := http.NewRequest(http.MethodPost, "https://api.mch.weixin.qq.com/pay/unifiedorder", strings.NewReader(mapToXML(params)))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/xml")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	var parsed unifiedOrderResp
	if err := xml.Unmarshal(body, &parsed); err != nil {
		return "", fmt.Errorf("parse unifiedorder response: %w", err)
	}
	if parsed.ReturnCode != "SUCCESS" {
		return "", fmt.Errorf("unifiedorder return_msg: %s", parsed.ReturnMsg)
	}
	if parsed.ResultCode != "SUCCESS" {
		return "", fmt.Errorf("unifiedorder error: %s", parsed.ErrCodeDes)
	}
	if parsed.PrepayID == "" {
		return "", fmt.Errorf("unifiedorder missing prepay_id")
	}
	return parsed.PrepayID, nil
}

// BuildJSAPIPayParams returns parameters for wx.requestPayment.
func BuildJSAPIPayParams(appID, apiKey, prepayID string) map[string]string {
	ts := fmt.Sprintf("%d", time.Now().Unix())
	nonce := RandomNonceStr(32)
	pkg := "prepay_id=" + prepayID
	params := map[string]string{
		"appId":     appID,
		"timeStamp": ts,
		"nonceStr":  nonce,
		"package":   pkg,
		"signType":  "MD5",
	}
	params["paySign"] = SignWxPayMap(params, apiKey)
	return params
}

// VerifyWxPayNotifyXML validates the notification signature from raw XML body.
func VerifyWxPayNotifyXML(body []byte, apiKey string) (ok bool, notify *WxPayNotify) {
	var n WxPayNotify
	if err := xml.Unmarshal(body, &n); err != nil {
		return false, nil
	}
	params := map[string]string{}
	decoder := xml.NewDecoder(strings.NewReader(string(body)))
	var current string
	for {
		tok, err := decoder.Token()
		if err != nil {
			break
		}
		switch t := tok.(type) {
		case xml.StartElement:
			current = t.Name.Local
		case xml.CharData:
			if current != "" && current != "xml" {
				val := strings.TrimSpace(string(t))
				if val != "" {
					params[current] = val
				}
			}
		case xml.EndElement:
			current = ""
		}
	}
	sign := params["sign"]
	delete(params, "sign")
	return SignWxPayMap(params, apiKey) == sign, &n
}

func WxPayNotifySuccessXML() string {
	return `<xml><return_code><![CDATA[SUCCESS]]></return_code><return_msg><![CDATA[OK]]></return_msg></xml>`
}

func WxPayNotifyFailXML(msg string) string {
	return fmt.Sprintf(`<xml><return_code><![CDATA[FAIL]]></return_code><return_msg><![CDATA[%s]]></return_msg></xml>`, msg)
}
