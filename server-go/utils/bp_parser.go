package utils

import (
	"regexp"
	"sort"
	"strconv"
	"strings"
)

type BPResult struct {
	Systolic           *int    `json:"systolic,omitempty"`
	Diastolic          *int    `json:"diastolic,omitempty"`
	HeartRate          *int    `json:"heartRate,omitempty"`
	Confidence         float64 `json:"confidence"`
	ExtractionStrategy string  `json:"extractionStrategy"`
}

type parsedItem struct {
	Value    int
	Top      int
	Original string
}

func ParseBPData(wordsResult []OCRResult) BPResult {
	result := BPResult{}
	if len(wordsResult) == 0 {
		return result
	}

	var numbers []parsedItem
	var texts []struct {
		Text string
		Top  int
	}

	numRegex := regexp.MustCompile(`[^\d.]`)

	for _, item := range wordsResult {
		cleanText := numRegex.ReplaceAllString(item.Words, "")
		if val, err := strconv.ParseFloat(cleanText, 64); err == nil && cleanText != "" {
			numbers = append(numbers, parsedItem{
				Value:    int(val),
				Top:      item.Location.Top,
				Original: item.Words,
			})
		} else {
			texts = append(texts, struct {
				Text string
				Top  int
			}{
				Text: strings.ToUpper(item.Words),
				Top:  item.Location.Top,
			})
		}
	}

	// Filter by reasonable range (30-300)
	var validNumbers []parsedItem
	for _, n := range numbers {
		if n.Value >= 30 && n.Value <= 300 {
			validNumbers = append(validNumbers, n)
		}
	}

	// Sort by vertical position
	sort.Slice(validNumbers, func(i, j int) bool {
		return validNumbers[i].Top < validNumbers[j].Top
	})

	// Strategy A: Keyword anchoring
	sysPattern := regexp.MustCompile(`(?i)SYS|HIG|收缩`)
	diaPattern := regexp.MustCompile(`(?i)DIA|LOW|舒张`)
	pulPattern := regexp.MustCompile(`(?i)PUL|HR|RATE|心率|MIN`)

	findNearestNumber := func(pattern *regexp.Regexp) *int {
		for _, t := range texts {
			if pattern.MatchString(t.Text) {
				for _, n := range validNumbers {
					verticalDist := n.Top - t.Top
					if verticalDist > -10 && verticalDist < 150 {
						val := n.Value
						return &val
					}
				}
			}
		}
		return nil
	}

	result.Systolic = findNearestNumber(sysPattern)
	result.Diastolic = findNearestNumber(diaPattern)
	result.HeartRate = findNearestNumber(pulPattern)

	if result.Systolic != nil && result.Diastolic != nil && result.HeartRate != nil {
		result.ExtractionStrategy = "keyword"
		result.Confidence = 0.9
		return result
	}

	keywordPartial := result.Systolic != nil || result.Diastolic != nil || result.HeartRate != nil

	// Strategy B: Positional inference
	var unusedNumbers []parsedItem
	for _, n := range validNumbers {
		used := false
		if result.Systolic != nil && n.Value == *result.Systolic {
			used = true
		}
		if result.Diastolic != nil && n.Value == *result.Diastolic {
			used = true
		}
		if result.HeartRate != nil && n.Value == *result.HeartRate {
			used = true
		}
		if !used {
			unusedNumbers = append(unusedNumbers, n)
		}
	}

	if result.Systolic == nil && len(unusedNumbers) > 0 {
		for i, n := range unusedNumbers {
			if n.Value > 80 {
				val := n.Value
				result.Systolic = &val
				unusedNumbers = append(unusedNumbers[:i], unusedNumbers[i+1:]...)
				break
			}
		}
	}

	if result.Diastolic == nil && len(unusedNumbers) > 0 {
		for i, n := range unusedNumbers {
			if result.Systolic == nil || n.Value < *result.Systolic {
				val := n.Value
				result.Diastolic = &val
				unusedNumbers = append(unusedNumbers[:i], unusedNumbers[i+1:]...)
				break
			}
		}
	}

	if result.HeartRate == nil && len(unusedNumbers) > 0 {
		val := unusedNumbers[0].Value
		result.HeartRate = &val
	}

	// Sanity check: swap if systolic < diastolic
	if result.Systolic != nil && result.Diastolic != nil && *result.Systolic < *result.Diastolic {
		*result.Systolic, *result.Diastolic = *result.Diastolic, *result.Systolic
	}

	// Compute confidence score
	if keywordPartial {
		result.ExtractionStrategy = "keyword+positional"
		result.Confidence = 0.7
	} else {
		result.ExtractionStrategy = "positional"
		result.Confidence = 0.5
	}
	fields := 0
	if result.Systolic != nil {
		fields++
	}
	if result.Diastolic != nil {
		fields++
	}
	if result.HeartRate != nil {
		fields++
	}
	if fields < 2 {
		result.Confidence *= 0.5
	}

	return result
}
