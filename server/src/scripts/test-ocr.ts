import fs from 'fs';
import path from 'path';
import { uploadImageToOSS } from '../utils/oss';
import { recognizeImage } from '../utils/baiduOcr';
import { parseBPData } from '../utils/bpParser';
import config from '../config';

// 确保环境变量已加载 (config/index.ts 应该已经处理了，但为了保险起见)
console.log('Config loaded. OSS Bucket:', config.oss.bucket);

const TEST_DIR = path.resolve(__dirname, '../../../test');

async function runTest() {
  if (!fs.existsSync(TEST_DIR)) {
    console.error(`Test directory not found: ${TEST_DIR}`);
    return;
  }

  const files = fs.readdirSync(TEST_DIR).filter(file => /\.(jpg|jpeg|png|webp)$/i.test(file));
  
  console.log(`Found ${files.length} images in ${TEST_DIR}`);

  for (const file of files) {
    console.log('\n---------------------------------------------------');
    console.log(`Processing: ${file}`);
    const filePath = path.join(TEST_DIR, file);
    const fileBuffer = fs.readFileSync(filePath);

    try {
      // 1. Upload to OSS
      console.log('Uploading to OSS...');
      const ossPath = await uploadImageToOSS(fileBuffer, file);
      console.log(`Uploaded: ${ossPath}`);

      // 2. OCR
      console.log('Calling Baidu OCR...');
      const wordsResult = await recognizeImage(fileBuffer);
      // console.log('Raw OCR Result:', JSON.stringify(wordsResult, null, 2));

      // 3. Parse
      console.log('Parsing data...');
      const result = parseBPData(wordsResult);
      console.log('Parsed Result:', JSON.stringify(result, null, 2));

    } catch (error: any) {
      console.error(`Error processing ${file}:`, error.message);
    }
    
    // Sleep for 1.5 seconds to avoid QPS limit
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
}

runTest().catch(console.error);
