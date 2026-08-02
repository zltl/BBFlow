package utils

import "testing"

func TestSignWxPayMapStable(t *testing.T) {
	params := map[string]string{
		"appid":       "wx123",
		"mch_id":      "190000",
		"nonce_str":   "abc",
		"body":        "test",
		"out_trade_no": "ORDER1",
		"total_fee":   "1",
		"trade_type":  "JSAPI",
	}
	s1 := SignWxPayMap(params, "key123")
	s2 := SignWxPayMap(params, "key123")
	if s1 == "" || s1 != s2 {
		t.Fatalf("sign unstable: %s vs %s", s1, s2)
	}
	if SignWxPayMap(params, "other") == s1 {
		t.Fatal("different keys should produce different signs")
	}
}
