import path from 'path';
import dotenv from 'dotenv';

// Load environment variables from .secret.dev in the project root
dotenv.config({ path: path.resolve(__dirname, '../../../.secret.dev') });

export default {
  port: process.env.PORT || 3000,
  wx: {
    appid: process.env.WC_APP_ID || '',
    secret: process.env.WC_APP_SECRET || '',
  },
  db: {
    host: process.env.PG_HOST || 'localhost',
    port: parseInt(process.env.PG_PORT || '5432', 10),
    database: process.env.PG_DBNAME || 'bbflow',
    user: process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD || ''
  },
  baidu: {
    apiKey: process.env.BAIDU_OCR_API_KEY || '',
    secretKey: process.env.BAIDU_OCR_SECRET_KEY || ''
  },
  oss: {
    region: process.env.ALIYUN_OSS_BUCKET_REGION || 'oss-cn-hangzhou',
    accessKeyId: process.env.ALIYUN_OSS_BUCKET_ACCESS_KEY_ID || '',
    accessKeySecret: process.env.ALIYUN_OSS_BUCKET_ACCESS_KEY_SECRET || '',
    bucket: process.env.ALIYUN_OSS_BUCKET_NAME || ''
  },
  llm: {
    apiKey: process.env.LLM_API_KEY || '',
    baseUrl: process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
    model: process.env.LLM_MODEL || 'gpt-4o'
  }
};
