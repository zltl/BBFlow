# BBFlow 项目结构说明 (Project Structure)

本文档旨在帮助开发者和 AI 助手快速理解本项目的目录结构及关键配置文件，特别是不同目录下的 `package.json` 的用途。

## 📂 目录概览 (Overview)

本项目采用类似 Monorepo 的结构，包含 **微信小程序前端** 和 **Node.js 后端服务**。

```text
BBFlow/
├── package.json                  # [ROOT] 小程序项目的构建配置与类型定义
├── tsconfig.json                 # [ROOT] 小程序的 TypeScript 配置
├── project.config.json           # 微信开发者工具项目配置文件
├── miniprogram/                  # 📱 [前端] 微信小程序源码目录
│   ├── app.ts                    # 小程序入口逻辑
│   ├── app.json                  # 小程序全局配置
│   ├── pages/                    # 页面目录 (记录、趋势、历史、分享等)
│   └── utils/                    # 前端通用工具 (request 封装等)
├── server/                       # 🖥️ [后端] Node.js/Express 服务端源码目录
│   ├── package.json              # [SERVER] 后端服务的依赖与脚本
│   ├── tsconfig.json             # [SERVER] 后端的 TypeScript 配置
│   └── src/                      # 后端源码
│       ├── app.ts                # 服务端入口
│       ├── routes/               # API 路由定义
│       ├── middleware/           # 中间件 (Auth, RateLimit)
│       └── db.ts                 # 数据库连接
└── docs/                         # 项目文档
```

## 📦 配置文件详解 (Configuration Files)

### 1. 根目录 `package.json`
*   **位置**: `./package.json`
*   **用途**: **微信小程序开发环境配置**
*   **主要职责**:
    *   管理小程序的 TypeScript 编译 (`npm run dev` -> `tsc -w`)。
    *   安装小程序开发所需的类型定义 (如 `miniprogram-api-typings`)。
    *   **注意**: 这里安装的 `dependencies` 通常不会被小程序直接打包（除非使用 npm 构建功能），主要是 `devDependencies`。

### 2. 服务端 `server/package.json`
*   **位置**: `./server/package.json`
*   **用途**: **后端服务依赖管理**
*   **主要职责**:
    *   管理后端运行时依赖 (Express, pg, cors, multer 等)。
    *   定义后端启动脚本 (`npm run dev` -> `nodemon src/app.ts`)。
    *   **注意**: 在开发后端功能时，请务必在 `server/` 目录下执行 `npm install`。

### 3. 微信配置 `project.config.json`
*   **位置**: `./project.config.json`
*   **用途**: **微信开发者工具配置**
*   **主要职责**:
    *   定义小程序根目录 (`miniprogramRoot`: `miniprogram/`)。
    *   定义编译设置 (ES6 转 ES5, TypeScript 编译等)。

## 🚀 开发指南 (Development Guide)

*   **前端开发 (小程序)**:
    *   在根目录运行 `npm install` 安装类型定义。
    *   在根目录运行 `npm run dev` 开启 TypeScript 实时编译。
    *   使用微信开发者工具打开项目根目录。

*   **后端开发 (Server)**:
    *   进入 `server/` 目录: `cd server`。
    *   运行 `npm install` 安装后端依赖。
    *   运行 `npm run dev` 启动开发服务器 (监听 3000 端口)。

## 🤖 给 GitHub Copilot 的提示 (Tips for Copilot)

*   当用户询问 **"小程序"** 或 **"前端"** 问题时，请关注 `miniprogram/` 目录及根目录下的 `package.json`。
*   当用户询问 **"服务端"**、**"API"** 或 **"数据库"** 问题时，请关注 `server/` 目录及其下的 `package.json`。
*   注意区分上下文：根目录的 `npm run dev` 是编译小程序 TS，`server` 目录下的 `npm run dev` 是启动后端服务。
