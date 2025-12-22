# BBFlow Server (Go)

Go 版本的 BBFlow 后端服务，相比 Node.js 版本内存占用更低。

## 特性

- 使用 Gin 框架构建 REST API
- PostgreSQL 数据库
- JWT 认证
- 百度 OCR 识别
- 阿里云 OSS 图片存储
- 速率限制

## 开发

```bash
# 安装依赖
go mod tidy

# 运行开发服务器
go run main.go

# 构建
go build -o bbflow-server
```

## 环境变量

在项目根目录创建 `.secret.dev` 文件:

```
PORT=3000
WC_APP_ID=your_wechat_app_id
WC_APP_SECRET=your_wechat_app_secret
PG_HOST=localhost
PG_PORT=5432
PG_DBNAME=bbflow
PG_USER=postgres
PG_PASSWORD=your_password
JWT_SECRET=your_jwt_secret
BAIDU_OCR_API_KEY=your_baidu_api_key
BAIDU_OCR_SECRET_KEY=your_baidu_secret_key
ALIYUN_OSS_BUCKET_REGION=oss-cn-hangzhou
ALIYUN_OSS_BUCKET_ACCESS_KEY_ID=your_oss_key_id
ALIYUN_OSS_BUCKET_ACCESS_KEY_SECRET=your_oss_key_secret
ALIYUN_OSS_BUCKET_NAME=your_bucket_name
LLM_API_KEY=your_llm_api_key
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o
```

## API 端点

### 认证
- `POST /api/auth/login` - 微信登录

### 血压记录
- `GET /api/records` - 获取记录列表
- `POST /api/records` - 新增记录
- `DELETE /api/records/:id` - 删除记录

### OCR
- `POST /api/ocr/recognize` - 识别血压计图片

### 分享
- `POST /api/share/generate-token` - 生成分享链接
- `GET /api/share/view/:token` - 查看分享数据 (JSON)
- `GET /api/share/html/:token` - 查看分享数据 (HTML)
