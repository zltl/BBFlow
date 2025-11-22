import { Pool, QueryResult } from 'pg';
import config from './config';

export const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  user: config.db.user,
  password: config.db.password,
});

pool.on('error', (err, client) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

const initDb = async () => {
  const client = await pool.connect();
  try {
    console.log('Connected to PostgreSQL database');
    
    // 用户表
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        openid TEXT UNIQUE NOT NULL,
        nickname TEXT,
        avatar_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 血压记录表
    await client.query(`
      CREATE TABLE IF NOT EXISTS bp_records (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        systolic INTEGER NOT NULL,
        diastolic INTEGER NOT NULL,
        heart_rate INTEGER,
        measured_at TIMESTAMP NOT NULL,
        tags TEXT,
        note TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(openid)
      );
    `);

    // OCR 识别日志表
    await client.query(`
      CREATE TABLE IF NOT EXISTS ocr_logs (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        image_path TEXT,
        raw_result TEXT,
        parsed_result TEXT,
        status TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(openid)
      );
    `);

    // 分享 Token 表
    await client.query(`
      CREATE TABLE IF NOT EXISTS share_tokens (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        time_range TEXT NOT NULL,
        share_future_data BOOLEAN DEFAULT FALSE,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(openid)
      );
    `);

    // Add rate_limit_config column to users table
    await client.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS rate_limit_config JSONB DEFAULT '{}';
    `);

    console.log('Database initialized successfully');
  } catch (err) {
    console.error('Error initializing database', err);
  } finally {
    client.release();
  }
};

// Initialize DB on startup
initDb();

export default {
  query: (text: string, params?: any[]): Promise<QueryResult> => pool.query(text, params),
};
