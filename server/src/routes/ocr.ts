import express from 'express';
import multer from 'multer';
import { recognizeImage } from '../utils/baiduOcr';
import { parseBPData } from '../utils/bpParser';
import { uploadImageToOSS } from '../utils/oss';
import { pool } from '../db';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { recordLimiter } from '../middleware/rateLimit';
import { RateLimitedQueue } from '../utils/rateLimiter';

const router = express.Router();

// Global OCR Rate Limiter: 10 QPS
const ocrQueue = new RateLimitedQueue(10);

// Apply middleware to all routes in this router
router.use(authenticateToken);

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 4 * 1024 * 1024, // 4MB limit (increased for better OCR)
  },
});

router.post('/recognize', recordLimiter, upload.single('image'), async (req: AuthRequest, res: express.Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image file provided' });
    }

    console.log(`[OCR] Starting OCR process for file: ${req.file.originalname}, size: ${req.file.size} bytes`);

    // 1. Upload to OSS (Async, but we wait for path)
    console.log('[OCR] Uploading image to OSS...');
    const ossPath = await uploadImageToOSS(req.file.buffer, req.file.originalname);
    console.log(`[OCR] Image uploaded to OSS: ${ossPath}`);

    // 2. Call Baidu OCR (Rate Limited)
    console.log('[OCR] Queuing Baidu OCR API call...');
    const wordsResult = await ocrQueue.enqueue(() => {
      console.log('[OCR] Executing Baidu OCR API call...');
      return recognizeImage(req.file!.buffer);
    });
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
