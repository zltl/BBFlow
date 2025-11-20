import express from 'express';
import multer from 'multer';
import { recognizeImage } from '../utils/baiduOcr';
import { parseBPData } from '../utils/bpParser';
import { uploadImageToOSS } from '../utils/oss';
import { pool } from '../db';

const router = express.Router();

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 4 * 1024 * 1024, // 4MB limit (increased for better OCR)
  },
});

router.post('/recognize', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image file provided' });
    }

    console.log(`[OCR] Starting OCR process for file: ${req.file.originalname}, size: ${req.file.size} bytes`);

    // 1. Upload to OSS (Async, but we wait for path)
    console.log('[OCR] Uploading image to OSS...');
    const ossPath = await uploadImageToOSS(req.file.buffer, req.file.originalname);
    console.log(`[OCR] Image uploaded to OSS: ${ossPath}`);

    // 2. Call Baidu OCR
    console.log('[OCR] Calling Baidu OCR API...');
    const wordsResult = await recognizeImage(req.file.buffer);
    console.log('[OCR] Baidu OCR Raw Result:', JSON.stringify(wordsResult, null, 2));
    
    // 3. Parse Data
    console.log('[OCR] Parsing OCR data...');
    const bpData = parseBPData(wordsResult);
    console.log('[OCR] Parsed BP Data:', JSON.stringify(bpData, null, 2));

    // 4. Save Log to DB
    const insertQuery = `
      INSERT INTO ocr_logs (image_path, ocr_raw_json, parsed_result)
      VALUES ($1, $2, $3)
      RETURNING id
    `;
    const dbRes = await pool.query(insertQuery, [
      ossPath,
      JSON.stringify(wordsResult),
      JSON.stringify(bpData)
    ]);
    const ocrLogId = dbRes.rows[0].id;

    // 5. Return result
    res.json({
      success: true,
      data: bpData,
      ocrLogId: ocrLogId
    });

  } catch (error: any) {
    console.error('OCR Error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Internal Server Error' 
    });
  }
});

export default router;
