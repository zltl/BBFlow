# BBFlow 项目结构说明 (Project Structure)

本文档帮助开发者快速理解项目目录结构及关键配置。

## 📂 目录概览

```text
BBFlow/
├── package.json                  # 小程序 TypeScript 编译配置
├── tsconfig.json                 # TypeScript 配置
├── project.config.json           # 微信开发者工具配置
├── miniprogram/                  # 📱 微信小程序前端
│   ├── app.ts / app.json         # 入口与全局配置
│   ├── pages/                    # 页面（首页、记录、历史、趋势、分享、设置等）
│   ├── components/               # 自定义组件
│   ├── utils/                    # 工具函数（request 封装等）
│   └── config.ts                 # API 地址配置
├── server-go/                    # 🖥️ Go 后端服务
│   ├── main.go                   # 服务入口与路由注册
│   ├── handlers/                 # API 处理器
│   │   ├── auth.go               # 微信登录
│   │   ├── records.go            # 血压记录 CRUD
│   │   ├── ocr.go                # OCR 识别
│   │   ├── ocr_verify.go         # OCR 结果校验
│   │   ├── insights.go           # 健康洞察分析
│   │   ├── medication.go         # 用药管理
│   │   ├── share.go              # 分享链接
│   │   ├── share_manage.go       # 分享管理（列表/撤销）
│   │   ├── data_export.go        # 数据导出/账号删除
│   │   ├── tickets.go            # 支持工单 + 管理员运营
│   │   ├── invite.go             # 邀请链接
│   │   ├── admin.go              # 激活码管理
│   │   ├── authorize.go          # 激活码激活
│   │   ├── feedback.go           # 反馈提交
│   │   ├── quota.go              # 配额计算
│   │   └── user.go               # 用户信息
│   ├── middleware/                # 中间件
│   │   ├── auth.go               # JWT 认证
│   │   ├── ratelimit.go          # 速率限制
│   │   ├── requestid.go          # X-Request-ID
│   │   ├── logging.go            # 请求日志
│   │   └── idempotency.go        # 幂等键
│   ├── logging/                  # 结构化日志
│   │   └── logger.go             # slog JSON 初始化
│   ├── utils/                    # 工具
│   │   ├── bp_parser.go          # OCR 结果解析（含置信度）
│   │   ├── baidu_ocr.go          # 百度 OCR API
│   │   ├── oss.go                # 阿里云 OSS
│   │   └── rate_limiter.go       # 队列限速器
│   ├── db/                       # 数据库
│   │   └── db.go                 # 连接池 + 表初始化 + 迁移
│   ├── config/                   # 配置
│   │   └── config.go             # 环境变量加载
│   └── static/                   # 静态文件（管理后台 HTML）
├── typings/                      # TypeScript 类型定义
└── docs/                         # 功能设计文档
```

## 📦 配置文件

| 文件 | 用途 |
|------|------|
| `package.json` (根目录) | 小程序 TypeScript 编译、类型定义安装 |
| `server-go/go.mod` | Go 模块依赖管理 |
| `project.config.json` | 微信开发者工具项目设置 |
| `tsconfig.json` | TypeScript 编译选项 |

## 🚀 开发指南

### 前端（小程序）
```bash
npm install          # 安装类型定义
npm run dev          # TypeScript 实时编译
# 使用微信开发者工具打开项目根目录
```

### 后端（Go 服务）
```bash
cd server-go
go mod tidy          # 安装依赖
go run main.go       # 启动开发服务器（默认端口 3000）
go test ./...        # 运行测试
go build -o bbflow-server  # 构建
```

## 数据库表

| 表名 | 用途 |
|------|------|
| `users` | 用户账号（含付费状态、管理员标志） |
| `bp_records` | 血压记录 |
| `ocr_logs` | OCR 识别日志（含置信度、校验状态） |
| `medications` | 药物管理 |
| `medication_logs` | 服药打卡记录 |
| `share_tokens` | 分享链接（含撤销、访问统计） |
| `share_access_logs` | 分享访问审计 |
| `feedbacks` | 用户反馈 |
| `activation_links` | 管理员激活码 |
| `invite_links` | 邀请链接 |
| `support_tickets` | 支持工单 |
| `ticket_messages` | 工单消息 |
| `analytics_events` | 分析事件 |
| `data_exports` | 数据导出请求 |
| `idempotency_keys` | 幂等键缓存 |
| `plans` | 订阅套餐 |
| `payment_orders` | 支付订单 |
| `subscriptions` | 用户订阅记录 |
