# AI Chatbot Supabase 项目架构文档

## 项目概述

这是一个基于 Next.js 15 和 Supabase 构建的现代化 AI 聊天机器人应用，集成了 Vercel AI SDK，支持多种 AI 模型提供商，具备完整的用户认证、聊天历史管理、文档处理和实时通信功能。

## 技术栈

### 前端技术
- **Next.js 15** - React 全栈框架，使用 App Router
- **React 19 RC** - 用户界面库
- **TypeScript** - 类型安全的 JavaScript
- **Tailwind CSS** - 原子化 CSS 框架
- **shadcn/ui** - 基于 Radix UI 的组件库
- **Framer Motion** - 动画库
- **next-themes** - 主题切换支持

### 后端技术
- **Supabase** - 后端即服务平台
  - PostgreSQL 数据库
  - 实时订阅
  - 文件存储
  - 行级安全 (RLS)
  - 身份认证
- **Vercel AI SDK** - AI 集成工具包
- **OpenAI API** - 默认 AI 模型提供商

### 开发工具
- **ESLint** - 代码质量检查
- **Prettier** - 代码格式化
- **pnpm** - 包管理器
- **Supabase CLI** - 数据库管理

## 项目结构

```
ai-chatbot-supabase/
├── app/                          # Next.js App Router 目录
│   ├── (auth)/                   # 认证相关路由组
│   ├── (chat)/                   # 聊天相关路由组
│   │   ├── api/                  # API 路由
│   │   ├── chat/                 # 聊天页面
│   │   ├── actions.ts            # Server Actions
│   │   ├── layout.tsx            # 聊天布局
│   │   └── page.tsx              # 主页
│   ├── auth/                     # 认证页面
│   ├── globals.css               # 全局样式
│   └── layout.tsx                # 根布局
├── components/                   # React 组件
│   ├── ui/                       # shadcn/ui 基础组件
│   └── custom/                   # 自定义组件
├── lib/                          # 工具库和配置
│   ├── editor/                   # 编辑器相关
│   ├── supabase/                 # Supabase 客户端配置
│   └── utils.ts                  # 工具函数
├── ai/                           # AI 相关配置
│   ├── index.ts                  # AI SDK 配置
│   ├── models.ts                 # AI 模型定义
│   ├── prompts.ts                # 提示词模板
│   └── custom-middleware.ts      # 自定义中间件
├── db/                           # 数据库操作
│   ├── queries.ts                # 查询函数
│   ├── mutations.ts              # 变更函数
│   ├── cached-queries.ts         # 缓存查询
│   ├── auth.ts                   # 认证相关
│   └── storage.ts                # 文件存储
├── hooks/                        # 自定义 React Hooks
├── supabase/                     # Supabase 配置
│   ├── migrations/               # 数据库迁移文件
│   └── config.toml               # Supabase 配置
└── public/                       # 静态资源
```

## 核心功能模块

### 1. 用户认证系统
- **位置**: `app/auth/`, `db/auth.ts`
- **功能**: 
  - 用户注册和登录
  - 会话管理
  - 行级安全策略
  - 多种认证提供商支持

### 2. AI 聊天引擎
- **位置**: `ai/`, `app/(chat)/api/`
- **功能**:
  - 支持多种 AI 模型 (GPT-4o, GPT-4o-mini)
  - 流式响应
  - 上下文管理
  - 自定义提示词

### 3. 聊天管理系统
- **位置**: `app/(chat)/`, `db/queries.ts`, `db/mutations.ts`
- **功能**:
  - 聊天会话创建和管理
  - 消息历史存储
  - 消息投票系统
  - 实时消息同步

### 4. 文档处理系统
- **位置**: `db/queries.ts`, `db/storage.ts`
- **功能**:
  - 文档上传和存储
  - 文档内容解析
  - 建议生成和管理
  - 版本控制

### 5. 用户界面组件
- **位置**: `components/`
- **功能**:
  - 响应式设计
  - 深色/浅色主题切换
  - 无障碍支持
  - 动画效果

## 数据库架构

### 核心表结构

1. **users** - 用户信息
2. **chats** - 聊天会话
3. **messages** - 聊天消息
4. **votes** - 消息投票
5. **documents** - 文档存储
6. **suggestions** - 文档建议

### 关键特性
- 行级安全 (RLS) 策略
- 实时订阅支持
- 自动时间戳
- 外键约束
- 索引优化

## API 设计

### RESTful 端点
- `GET /api/chat` - 获取聊天列表
- `POST /api/chat` - 创建新聊天
- `GET /api/chat/[id]` - 获取特定聊天
- `POST /api/chat/[id]/messages` - 发送消息
- `POST /api/vote` - 消息投票

### Server Actions
- 聊天操作
- 用户认证
- 文档管理
- 设置更新

## 安全特性

### 认证和授权
- JWT 令牌认证
- 行级安全策略
- CSRF 保护
- 安全头设置

### 数据保护
- 输入验证和清理
- SQL 注入防护
- XSS 防护
- 敏感数据加密

## 性能优化

### 前端优化
- React Server Components
- 静态生成 (SSG)
- 增量静态再生 (ISR)
- 图片优化
- 代码分割

### 后端优化
- 数据库索引
- 查询缓存
- 连接池
- CDN 集成

## 部署架构

### 开发环境
- 本地 Supabase 实例
- Next.js 开发服务器
- 热重载支持

### 生产环境
- Vercel 部署
- Supabase 云服务
- 环境变量管理
- 自动化 CI/CD

## 扩展性考虑

### 水平扩展
- 无状态应用设计
- 数据库读写分离
- 缓存层集成
- 负载均衡

### 功能扩展
- 插件系统架构
- 多语言支持
- 第三方集成
- 自定义模型支持

## 监控和日志

### 应用监控
- Vercel Analytics
- 错误追踪
- 性能监控
- 用户行为分析

### 日志管理
- 结构化日志
- 日志聚合
- 告警系统
- 审计跟踪

## 开发工作流

### 代码质量
- TypeScript 严格模式
- ESLint 规则
- Prettier 格式化
- 预提交钩子

### 测试策略
- 单元测试
- 集成测试
- E2E 测试
- 性能测试

### 版本控制
- Git 工作流
- 分支策略
- 代码审查
- 自动化部署

## 故障排除

### 常见问题
- Supabase 连接问题
- 环境变量配置
- 构建错误
- 认证失败

### 调试工具
- 浏览器开发者工具
- Supabase 仪表板
- Vercel 日志
- 本地调试

## 未来规划

### 短期目标
- 性能优化
- 功能完善
- 用户体验改进
- 安全加固

### 长期愿景
- 多模态支持
- 企业级功能
- 开源生态
- 国际化支持

---

*最后更新: 2024年12月*
*维护者: 项目团队* 