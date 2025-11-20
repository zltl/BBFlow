import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import config from './config';
import authRoutes from './routes/auth';
import recordRoutes from './routes/records';
import ocrRoutes from './routes/ocr';
import './db'; // Initialize DB

const app = express();
const PORT = config.port;

// 中间件
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// 请求日志中间件
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.url}`);
  if (req.body && Object.keys(req.body).length > 0) {
    console.log('Body:', JSON.stringify(req.body, null, 2));
  }
  next();
});

// 路由
app.use('/api/auth', authRoutes);
app.use('/api/records', recordRoutes);
app.use('/api/ocr', ocrRoutes);

// 基础健康检查
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'BBFlow Server is running' });
});

// 启动服务
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
