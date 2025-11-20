# BBFlow Server

## 1. 技术选型
考虑到个人开发者维护成本和开发效率，后端采用轻量级方案：
- **运行环境**: Node.js (建议 v14+)
- **Web框架**: Express.js (成熟稳定，文档丰富)
- **数据库**: SQLite3 (无需安装额外的数据库软件，数据存储在本地文件中，备份方便)
- **部署**: 可部署在任意云服务器 (如腾讯云轻量应用服务器)

## 2. 目录结构
```
server/
├── data/               # 存放 SQLite 数据库文件
├── src/
│   ├── config/         # 配置文件 (AppID, Secret 等)
│   ├── routes/         # 路由定义
│   ├── utils/          # 工具函数
│   ├── app.js          # 应用入口
│   └── db.js           # 数据库初始化
├── package.json
└── README.md
```

## 3. 接口规划 (V1.0)

### 用户模块
- `POST /api/auth/login`: 微信登录，接收 code，返回 openid/token

### 血压记录模块
- `POST /api/records`: 新增血压记录
- `GET /api/records`: 获取记录列表 (支持分页、时间筛选)
- `GET /api/records/:id`: 获取单条详情
- `DELETE /api/records/:id`: 删除记录

### 工具模块
- `POST /api/upload`: 图片上传 (用于 OCR)

## 4. 快速开始

### 安装依赖
```bash
cd server
npm install
```

### 启动服务
```bash
npm start
```
服务默认运行在 3000 端口。
