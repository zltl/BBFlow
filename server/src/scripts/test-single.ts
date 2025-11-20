import fs from 'fs';
import path from 'path';
import { uploadImageToOSS } from '../utils/oss';
import { recognizeImage } from '../utils/baiduOcr';
import { parseBPData } from '../utils/bpParser';
import config from '../config';

console.log('Config loaded.');

const TEST_DIR = path.resolve(__dirname, '../../../test');
const TARGET_FILE_KEYWORD = '182128008'; // 识别文件名的关键词

async function runSingleTest() {
  if (!fs.existsSync(TEST_DIR)) {
    console.error(`Test directory not found: ${TEST_DIR}`);
    return;
  }

  const files = fs.readdirSync(TEST_DIR);
  const targetFile = files.find(f => f.includes(TARGET_FILE_KEYWORD));

  if (!targetFile) {
    console.error(`Target file with keyword "${TARGET_FILE_KEYWORD}" not found in ${TEST_DIR}`);
    return;
  }

  console.log(`\nProcessing Target File: ${targetFile}`);
  const filePath = path.join(TEST_DIR, targetFile);
  const fileBuffer = fs.readFileSync(filePath);

  try {
    // 1. Upload to OSS
    console.log('Uploading to OSS...');
    const ossPath = await uploadImageToOSS(fileBuffer, targetFile);
    console.log(`Uploaded: ${ossPath}`);

    // 2. OCR
    console.log('Calling Baidu OCR...');
    const wordsResult = await recognizeImage(fileBuffer);
    console.log('Raw OCR Result (First 5 items):', JSON.stringify(wordsResult.slice(0, 5), null, 2));

    // 3. Parse
    console.log('Parsing data...');
    const result = parseBPData(wordsResult);
    console.log('---------------------------------------------------');
    console.log('Parsed Result:', JSON.stringify(result, null, 2));
    console.log('---------------------------------------------------');

  } catch (error: any) {
    console.error(`Error processing ${targetFile}:`, error.message);
    if (error.response) {
        console.error('API Response:', error.response.data);
    }
  }
}

runSingleTest().catch(console.error);
