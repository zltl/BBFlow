# BBFlow Server (Go)

Go 后端服务，提供完整的血压管理 REST API。

## 特性

- **Gin** 框架构建 REST API
- **PostgreSQL** 数据库，自动迁移
- **JWT** 认证（微信登录）
- **百度 OCR** 血压计图片识别，含置信度评分
- **阿里云 OSS** 图片存储
- **结构化 JSON 日志** (`log/slog`)，请求级 Request ID 追踪
- **速率限制**（按用户/IP，可配置窗口）
- **幂等键**支持（写操作防重复）
- 单元测试覆盖核心逻辑

## 开发

```bash
go mod tidy
go run main.go       # 开发
go build -o bbflow-server  # 构建
go test ./...        # 测试
```

## 环境变量

在项目根目录创建 `.secret.dev` 文件:

```
PORT=3000
LOG_LEVEL=info
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
- `POST /api/auth/authorize` - 激活码激活 🔒
- `GET /api/auth/me` - 获取用户信息 🔒

### 血压记录
- `GET /api/records` - 获取记录列表 🔒
- `POST /api/records` - 新增记录（支持 Idempotency-Key）🔒
- `DELETE /api/records/:id` - 删除记录 🔒

### OCR 识别
- `POST /api/ocr/recognize` - 识别血压计图片 🔒
- `POST /api/ocr/verify` - 确认/修正 OCR 结果 🔒

### 健康洞察
- `GET /api/insights?days=30` - 获取健康洞察分析 🔒

### 用药管理
- `GET /api/medications` - 药物列表 🔒
- `POST /api/medications` - 添加药物 🔒
- `PUT /api/medications/:id` - 更新药物 🔒
- `DELETE /api/medications/:id` - 停用药物 🔒
- `POST /api/medications/log` - 服药打卡 🔒
- `GET /api/medications/adherence?days=30` - 依从性统计 🔒

### 数据分享
- `POST /api/share/generate-token` - 生成分享链接 🔒
- `GET /api/share/list` - 列出我的分享 🔒
- `POST /api/share/revoke/:token` - 撤销分享 🔒
- `GET /api/share/view/:token` - 查看分享数据 (JSON)
- `GET /api/share/html/:token` - 查看分享数据 (HTML)

### 数据导出
- `GET /api/export/json` - 导出全部数据 (JSON) 🔒
- `GET /api/export/csv` - 导出血压记录 (CSV) 🔒
- `DELETE /api/account` - 删除账号 🔒

### 支付与订阅
- `GET /api/plans` - 获取套餐列表
- `POST /api/payment/order` - 创建支付订单并返回 JSAPI 支付参数（支持 Idempotency-Key）🔒
- `POST /api/payment/orders/:order_no/close` - 关闭待支付订单 🔒
- `GET /api/payment/subscription` - 查询订阅状态 🔒
- `GET /api/payment/orders` - 订单历史 🔒
- `POST /api/payment/notify` - 微信支付 XML 回调（验签）
- `POST /api/payment/callback` - 管理员手动确认支付（需 `X-Admin-Secret`）
- `GET/PUT /api/reminders/prefs` - 用药/测量提醒偏好 🔒
- `GET/PUT /api/records/:id` - 获取/更新单条血压记录 🔒

### 支持工单
- `POST /api/tickets` - 创建工单 🔒
- `GET /api/tickets` - 我的工单列表 🔒
- `GET /api/tickets/:id/messages` - 工单消息 🔒
- `POST /api/tickets/:id/reply` - 回复工单 🔒

### 邀请体系
- `POST /api/invite/create` - 创建邀请链接 🔒
- `GET /api/invite/list` - 我的邀请链接 🔒
- `POST /api/invite/use` - 使用邀请码 🔒

### 反馈
- `POST /api/feedback` - 提交反馈 🔒

### 管理后台 (🔒 Admin)
- `POST /api/admin/activation-links` - 生成激活码
- `GET /api/admin/activation-links` - 列出激活码
- `DELETE /api/admin/activation-links/:code` - 删除激活码
- `GET /api/admin/tickets` - 所有工单
- `POST /api/admin/tickets/:id/reply` - 回复工单
- `POST /api/admin/tickets/:id/close` - 关闭工单
- `GET /api/admin/users/search?q=` - 搜索用户
- `GET /api/admin/analytics` - 数据统计

🔒 = 需要 JWT 认证
