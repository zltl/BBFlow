package utils

import "testing"

func intPtr(v int) *int { return &v }

func makeOCR(words string, top int) OCRResult {
	return OCRResult{
		Words: words,
		Location: struct {
			Top    int `json:"top"`
			Left   int `json:"left"`
			Width  int `json:"width"`
			Height int `json:"height"`
		}{Top: top},
	}
}

func TestParseBPData_KeywordAnchoring(t *testing.T) {
	input := []OCRResult{
		makeOCR("SYS", 10),
		makeOCR("128", 20),
		makeOCR("DIA", 100),
		makeOCR("82", 110),
		makeOCR("PUL", 200),
		makeOCR("72", 210),
	}
	result := ParseBPData(input)
	if result.Systolic == nil || *result.Systolic != 128 {
		t.Errorf("expected systolic=128, got %v", result.Systolic)
	}
	if result.Diastolic == nil || *result.Diastolic != 82 {
		t.Errorf("expected diastolic=82, got %v", result.Diastolic)
	}
	if result.HeartRate == nil || *result.HeartRate != 72 {
		t.Errorf("expected heartrate=72, got %v", result.HeartRate)
	}
}

func TestParseBPData_PositionalInference(t *testing.T) {
	input := []OCRResult{
		makeOCR("135", 10),
		makeOCR("88", 50),
		makeOCR("65", 100),
	}
	result := ParseBPData(input)
	if result.Systolic == nil || *result.Systolic != 135 {
		t.Errorf("expected systolic=135, got %v", result.Systolic)
	}
	if result.Diastolic == nil || *result.Diastolic != 88 {
		t.Errorf("expected diastolic=88, got %v", result.Diastolic)
	}
	if result.HeartRate == nil || *result.HeartRate != 65 {
		t.Errorf("expected heartrate=65, got %v", result.HeartRate)
	}
}

func TestParseBPData_SwapCorrection(t *testing.T) {
	input := []OCRResult{
		makeOCR("SYS", 10),
		makeOCR("75", 20),
		makeOCR("DIA", 100),
		makeOCR("130", 110),
	}
	result := ParseBPData(input)
	if result.Systolic == nil || *result.Systolic != 130 {
		t.Errorf("expected systolic=130 after swap, got %v", result.Systolic)
	}
	if result.Diastolic == nil || *result.Diastolic != 75 {
		t.Errorf("expected diastolic=75 after swap, got %v", result.Diastolic)
	}
}

func TestParseBPData_OutOfRangeFiltered(t *testing.T) {
	input := []OCRResult{
		makeOCR("5", 10),
		makeOCR("999", 50),
		makeOCR("120", 100),
		makeOCR("80", 150),
	}
	result := ParseBPData(input)
	if result.Systolic == nil || *result.Systolic != 120 {
		t.Errorf("expected systolic=120, got %v", result.Systolic)
	}
	if result.Diastolic == nil || *result.Diastolic != 80 {
		t.Errorf("expected diastolic=80, got %v", result.Diastolic)
	}
}

func TestParseBPData_EmptyInput(t *testing.T) {
	result := ParseBPData(nil)
	if result.Systolic != nil || result.Diastolic != nil || result.HeartRate != nil {
		t.Errorf("expected all nil for empty input, got %+v", result)
	}
}
