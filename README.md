# BBFlow - 高血压健康管理平台

## 简介

BBFlow 是一个面向高血压患者的健康管理平台，包含微信小程序前端和 Go 后端服务。帮助用户记录血压数据、通过 OCR 自动识别血压计读数、分析健康趋势、管理用药方案，并提供数据分享与导出能力。

微信搜索 "安压宝" 使用。

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | 微信小程序 (TypeScript) |
| 后端 | Go + Gin |
| 数据库 | PostgreSQL |
| 对象存储 | 阿里云 OSS |
| OCR | 百度 OCR API |
| 认证 | 微信登录 + JWT |

## 核心功能

### 已实现
- **血压记录** - 手动录入 / OCR 拍照识别（含置信度评分与校验流程）
- **趋势分析** - 历史记录查看、按日期/标签筛选
- **健康洞察** - 规则引擎驱动的趋势分析、异常检测、风险评分
- **用药管理** - 药物CRUD、服药打卡、依从性统计
- **数据分享** - 生成可过期/可撤销的分享链接，含访问审计
- **数据导出** - JSON/CSV 格式导出、账号数据删除
- **支持工单** - 用户提交/追踪问题，管理员回复/关闭
- **邀请体系** - 激活码 + 邀请链接分发
- **管理后台** - 用户搜索、数据分析、工单管理

### 工程能力
- 结构化 JSON 日志 (`log/slog`)，请求级 Request ID 追踪
- 单元测试覆盖 OCR 解析、限流中间件
- 幂等键支持（写操作）
- 每请求限流（按用户/IP）

## 项目结构

详细说明见 [PROJECT_STRUCTURE.md](./PROJECT_STRUCTURE.md)。

```
BBFlow/
├── miniprogram/          # 微信小程序前端
│   ├── pages/            # 页面（首页、记录、历史、趋势、分享、设置等）
│   ├── components/       # 自定义组件
│   ├── utils/            # 工具函数
│   └── config.ts         # API 配置
├── server-go/            # Go 后端服务
│   ├── handlers/         # API 处理器
│   ├── middleware/        # 中间件（认证、限流、日志、幂等）
│   ├── logging/          # 结构化日志
│   ├── utils/            # OCR 解析、百度 API、OSS
│   ├── db/               # 数据库初始化与迁移
│   └── config/           # 配置管理
├── docs/                 # 功能设计文档
└── typings/              # TypeScript 类型定义
```

## 快速开始

### 后端

```bash
cd server-go
cp ../.secret.dev.example ../.secret.dev  # 配置环境变量
go build ./...
./bbflow-server
```

### 前端

```bash
npm install
npm run build
# 使用微信开发者工具打开 miniprogram/ 目录
```

## 环境变量

| 变量 | 说明 |
|------|------|
| `WC_APP_ID` / `WC_APP_SECRET` | 微信小程序凭证 |
| `PG_HOST` / `PG_PORT` / `PG_DBNAME` / `PG_USER` / `PG_PASSWORD` | PostgreSQL 连接 |
| `JWT_SECRET` | JWT 签名密钥 |
| `BAIDU_OCR_API_KEY` / `BAIDU_OCR_SECRET_KEY` | 百度 OCR 凭证 |
| `ALIYUN_OSS_*` | 阿里云 OSS 凭证 |
| `ADMIN_SECRET` | 管理员认证密钥 |
| `LOG_LEVEL` | 日志级别 (debug/info/warn/error) |
| `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` | LLM 配置（预留） |

## 注意事项

- 所有健康洞察仅供参考，不构成医疗诊断或治疗建议
- 请确保血压计的准确性
- 请在安静、放松的状态下测量血压
