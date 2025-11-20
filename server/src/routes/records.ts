import express, { Request, Response } from 'express';
import { pool } from '../db';

const router = express.Router();

// 获取记录列表
router.get('/', async (req: Request, res: Response) => {
  const { openid } = req.query; // 实际应从 token 中解析
  
  if (!openid) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const sql = `SELECT * FROM bp_records WHERE user_id = $1 ORDER BY measured_at DESC`;
  
  try {
    const { rows } = await pool.query(sql, [openid]);
    res.json({ data: rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 新增记录
router.post('/', async (req: Request, res: Response) => {
  const { openid, systolic, diastolic, heartRate, measuredAt, tags, note, ocrLogId } = req.body;

  if (!openid || !systolic || !diastolic) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Insert Record
    const insertSql = `INSERT INTO bp_records (user_id, systolic, diastolic, heart_rate, measured_at, tags, note) 
               VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`;
    
    const params = [
      openid, 
      systolic, 
      diastolic, 
      heartRate, 
      measuredAt || new Date().toISOString(), 
      JSON.stringify(tags || []), 
      note || ''
    ];

    const { rows } = await client.query(insertSql, params);
    const recordId = rows[0].id;

    // 2. Update OCR Log if exists
    if (ocrLogId) {
      const updateOcrSql = `
        UPDATE ocr_logs 
        SET record_id = $1, 
            final_result = $2 
        WHERE id = $3
      `;
      const finalResult = { systolic, diastolic, heartRate };
      await client.query(updateOcrSql, [recordId, JSON.stringify(finalResult), ocrLogId]);
    }

    await client.query('COMMIT');

    res.json({ 
      id: recordId, 
      message: 'Record saved successfully' 
    });
  } catch (err: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// 删除记录
router.delete('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { openid } = req.query; // 简单的权限检查

  const sql = `DELETE FROM bp_records WHERE id = $1 AND user_id = $2`;
  
  try {
    const result = await pool.query(sql, [id, openid]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Record not found or permission denied' });
    }
    res.json({ message: 'Record deleted' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
