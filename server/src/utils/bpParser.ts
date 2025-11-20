interface OCRLocation {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface OCRWord {
  words: string;
  location: OCRLocation;
}

interface BPResult {
  systolic?: number;
  diastolic?: number;
  heartRate?: number;
}

interface ParsedItem {
  value: number;
  location: OCRLocation;
  original: string;
}

export function parseBPData(wordsResult: OCRWord[]): BPResult {
  if (!wordsResult || wordsResult.length === 0) {
    return {};
  }

  // 1. Pre-process: Separate numbers and text
  const numbers: ParsedItem[] = [];
  const texts: { text: string; location: OCRLocation }[] = [];

  wordsResult.forEach(item => {
    const cleanText = item.words.replace(/[^\d.]/g, '');
    const val = parseFloat(cleanText);
    
    if (!isNaN(val) && cleanText.length > 0) {
      numbers.push({
        value: val,
        location: item.location,
        original: item.words
      });
    } else {
      texts.push({
        text: item.words.toUpperCase(),
        location: item.location
      });
    }
  });

  // 2. Filter numbers by reasonable range (loose filter)
  // BP monitors usually show 40-250. Heart rate 30-200.
  let validNumbers = numbers.filter(n => n.value >= 30 && n.value <= 300);

  // 3. Sort by vertical position (top to bottom)
  validNumbers.sort((a, b) => a.location.top - b.location.top);

  // 4. Strategy A: Keyword Anchoring (SYS, DIA, PULSE)
  // Try to find numbers near these keywords
  const resultA: BPResult = {};
  
  const findNearestNumber = (keywordPattern: RegExp, type: 'sys' | 'dia' | 'pul') => {
    const anchor = texts.find(t => keywordPattern.test(t.text));
    if (anchor) {
      // Find number that is below the anchor or to the right
      // "Below" means: number.top > anchor.top
      // "Close" means: vertical distance is small
      const candidate = validNumbers.find(n => {
        const verticalDist = n.location.top - anchor.location.top;
        // Must be below (-10 buffer) and within reasonable distance (e.g. 100px)
        return verticalDist > -10 && verticalDist < 150;
      });
      
      if (candidate) {
        if (type === 'sys') resultA.systolic = candidate.value;
        if (type === 'dia') resultA.diastolic = candidate.value;
        if (type === 'pul') resultA.heartRate = candidate.value;
        return true;
      }
    }
    return false;
  };

  findNearestNumber(/SYS|HIG|收缩/i, 'sys');
  findNearestNumber(/DIA|LOW|舒张/i, 'dia');
  findNearestNumber(/PUL|HR|RATE|心率|min/i, 'pul');

  // If Strategy A found everything, return it
  if (resultA.systolic && resultA.diastolic && resultA.heartRate) {
    return resultA;
  }

  // 5. Strategy B: Positional Inference (Fallback)
  // If we have 3 numbers vertically aligned, assume Sys -> Dia -> Pulse
  const resultB: BPResult = { ...resultA };
  
  // Remove numbers already used in Strategy A to avoid duplicates? 
  // Actually, let's just fill in the gaps.

  const unusedNumbers = validNumbers.filter(n => {
    return n.value !== resultB.systolic && 
           n.value !== resultB.diastolic && 
           n.value !== resultB.heartRate;
  });

  if (!resultB.systolic && unusedNumbers.length > 0) {
    // Take the top-most valid number as Systolic
    // Systolic is usually > 80
    const sysCandidate = unusedNumbers.find(n => n.value > 80);
    if (sysCandidate) {
      resultB.systolic = sysCandidate.value;
      // Remove from unused
      const idx = unusedNumbers.indexOf(sysCandidate);
      if (idx > -1) unusedNumbers.splice(idx, 1);
    }
  }

  if (!resultB.diastolic && unusedNumbers.length > 0) {
    // Take the next top-most as Diastolic
    // Diastolic is usually < Systolic
    const diaCandidate = unusedNumbers.find(n => {
      if (resultB.systolic) return n.value < resultB.systolic;
      return n.value < 130; // Guess
    });
    if (diaCandidate) {
      resultB.diastolic = diaCandidate.value;
      const idx = unusedNumbers.indexOf(diaCandidate);
      if (idx > -1) unusedNumbers.splice(idx, 1);
    }
  }

  if (!resultB.heartRate && unusedNumbers.length > 0) {
    // Remaining one is likely Heart Rate
    resultB.heartRate = unusedNumbers[0].value;
  }

  // 6. Final Sanity Check & Swap
  if (resultB.systolic && resultB.diastolic && resultB.systolic < resultB.diastolic) {
    const temp = resultB.systolic;
    resultB.systolic = resultB.diastolic;
    resultB.diastolic = temp;
  }

  return resultB;
}
