# 企业云盘管理系统 (Cloud Drive Management System)

企业云盘管理系统是一个功能完善、安全高效的企业级文件存储与协作平台。系统采用 B/S 架构，支持多种登录方式、用户与群组管理、文件秒传、在线编辑、文件分享、版本历史、回收站等核心功能，同时提供完善的操作审计与权限控制机制。

## 功能特性

### 多方式登录
- **密码登录**：支持用户名/邮箱/手机号 + 密码登录
- **邮箱验证码登录**：支持邮箱验证码快捷登录
- **用户注册**：支持新用户自助注册
- **忘记密码**：邮箱验证重置密码

### 用户与群组管理
- **用户管理**：管理员可创建、编辑、禁用/启用、删除用户
- **角色管理**：支持管理员/普通用户双角色体系
- **群组管理**：创建群组、成员管理、角色分配（群主/管理员/成员）、退出群组
- **存储配额**：每个用户独立存储空间，实时统计使用情况

### 文件管理核心功能
- **文件秒传**：基于 MD5 哈希检测，相同文件无需重复上传
- **文件上传/下载**：支持拖拽上传、批量删除
- **文件夹管理**：创建文件夹、目录树浏览、面包屑导航
- **文件操作**：重命名、移动、复制、删除（软删除）
- **文件搜索**：按文件名快速检索
- **文件筛选**：按类型（图片/文档/视频/音频/压缩包/代码）分类浏览
- **多种排序**：按文件名、大小、修改时间排序
- **回收站**：文件删除后进入回收站，支持恢复、永久删除、一键清空

### 在线编辑
- **文本文件编辑**：支持 txt、md、json、xml、html、css、js、py 等多种格式
- **语法高亮**：基于 CodeMirror，支持 JavaScript/Python/HTML/CSS/Go/Rust 等 15+ 语言
- **版本管理**：每次保存自动生成版本记录，可查看版本历史和回滚
- **自动保存**：输入暂停 3 秒后自动保存
- **快捷键支持**：Ctrl+S 快速保存

### 文件分享
- **文件/文件夹分享**：支持单个文件和整个文件夹分享
- **分享链接**：生成唯一分享码
- **密码保护**：提取密码验证，bcrypt 加密存储
- **权限控制**：可设置仅查看、允许下载、允许编辑
- **有效期设置**：支持 1 小时、24 小时、7 天、30 天或永久有效
- **下载限制**：可设置最大下载次数

### 媒体预览
- **图片预览**：支持 JPG、PNG、GIF、BMP、WebP 等格式弹窗查看
- **视频播放**：支持 MP4、AVI、MOV、MKV 等格式在线播放
- **音频播放**：支持 MP3、WAV、AAC、FLAC 等格式在线试听

### 数据安全保障
- **密码加密**：使用 bcrypt 加密存储用户密码
- **JWT 认证**：基于 Token 的身份验证机制，支持 Token 刷新
- **HTTPS 支持**：内置 SSL 配置，可选加密传输
- **存储隔离**：文件按用户隔离存储
- **权限校验**：细粒度的文件/文件夹访问控制
- **操作审计**：完整的操作日志记录，所有关键操作可追溯
- **登录日志**：记录登录成功/失败信息，便于安全分析

### 存储统计
- **空间概览**：仪表盘展示总空间、已用空间、文件总数
- **类型分布**：按文件类型统计数量和占用空间
- **使用趋势**：存储使用进度条可视化展示
- **群组统计**：各群组存储用量分布

## 技术架构

### 前端技术栈
| 技术 | 说明 |
|------|------|
| HTML5 | 页面结构 |
| CSS3 | 页面样式（响应式布局） |
| JavaScript (ES6+) | 前端逻辑 |
| Bootstrap 5 | UI 框架 |
| Font Awesome 6 | 图标库 |
| CodeMirror 5 | 代码编辑器（语法高亮） |
| SparkMD5 | 浏览器端 MD5 计算（秒传） |
| Fetch API | HTTP 请求 |

### 后端技术栈
| 技术 | 说明 |
|------|------|
| Node.js | 运行环境 |
| Express | Web 框架 |
| MySQL 8.0+ | 数据库 |
| MySQL2 | 数据库驱动 |
| bcryptjs | 密码加密 |
| jsonwebtoken | JWT 认证 |
| multer | 文件上传处理 |
| morgan | HTTP 日志 |
| archiver | ZIP 打包下载 |
| iconv-lite | 中文编码处理 |
| helmet | 安全头配置（CSP） |

### 系统架构

```
┌──────────────────────────────────────────────┐
│                浏览器 (Browser)                │
├──────────────────────────────────────────────┤
│         Express Web Server (Node.js)          │
├──────────┬──────────┬───────────────────────┤
│  认证模块  │ 文件管理  │  群组/用户管理         │
│  JWT Auth │ 秒传/编辑 │  RBAC 权限控制         │
│  多方式登录 │ 回收站    │  操作日志审计          │
├──────────┴──────────┴───────────────────────┤
│              MySQL 数据库                      │
└──────────────────────────────────────────────┘
```

## 快速开始

### 环境要求
- Node.js >= 16.x
- MySQL >= 8.0
- npm >= 8.x

### 1. 克隆项目

```bash
git clone <项目地址>
cd cloud-drive
```

### 2. 初始化数据库

登录 MySQL 并执行数据库初始化脚本：

```bash
mysql -u root -p < init.sql
```

### 3. 安装依赖

```bash
npm install
```

### 4. 配置数据库连接

编辑 `server/config.js`，修改数据库配置：

```javascript
db: {
  host: 'localhost',
  port: 3306,
  user: 'root',
  password: 'your_password',  // 修改为实际的数据库密码
  database: 'cloud_drive'
}
```

### 5. 启动服务

```bash
npm start
```

服务默认运行在 `http://localhost:3000`

### 6. 访问系统

打开浏览器访问：`http://localhost:3000`

### 默认管理员账号

| 用户名 | 密码 | 角色 |
|--------|------|------|
| admin | admin123456 | 管理员 |

> **安全提示**：生产环境部署后请及时修改默认密码！

## 项目结构

```
cloud-drive/
├── README.md                      # 项目文档
├── package.json                   # 项目配置
├── ecosystem.config.js            # PM2 进程管理配置
├── init.sql                       # 数据库初始化脚本
├── server/                        # 后端服务
│   ├── app.js                     # 服务入口（路由、安全配置、SSL）
│   ├── config.js                  # 配置文件（数据库、JWT、存储等）
│   ├── middleware/                 # 中间件
│   │   ├── auth.js               # 认证中间件（JWT验证、权限控制、操作日志）
│   │   └── upload.js             # 文件上传中间件（Multer配置、MD5实时计算）
│   ├── models/                    # 数据模型
│   │   └── db.js                 # 数据库连接池
│   └── routes/                    # 路由处理
│       ├── auth.js               # 认证路由（注册、登录、验证码、忘记密码）
│       ├── users.js              # 用户管理路由（CRUD、日志查询）
│       ├── groups.js             # 群组管理路由（创建、成员管理）
│       └── files.js              # 文件管理路由（核心功能、回收站、版本历史）
├── public/                        # 前端静态文件
│   ├── index.html                 # 首页（功能展示、引导）
│   ├── login.html                 # 登录/注册/忘记密码页
│   ├── reset-password.html        # 密码重置页
│   ├── dashboard.html             # 工作台仪表盘（统计概览、最近文件）
│   ├── file-manager.html          # 文件管理器（核心页面）
│   ├── online-edit.html           # 在线编辑器（CodeMirror 语法高亮）
│   ├── share-expired.html         # 分享失效提示页
│   ├── css/
│   │   └── style.css             # 全局样式（布局、组件、Toast、动画）
│   ├── js/
│   │   ├── api.js                # API 请求封装（自动刷新 Token）
│   │   └── auth.js               # 认证工具 + Toast 通知组件
│   └── admin/
│       ├── users.html            # 用户管理（管理员）
│       └── groups.html           # 群组管理
└── storage/                       # 文件存储目录（自动生成）
```

## 数据库设计

### 核心表结构

| 表名 | 说明 | 核心字段 |
|------|------|---------|
| `users` | 用户表 | 用户名、密码、邮箱、手机号、角色、存储配额 |
| `groups` | 群组表 | 群组名称、描述、创建者、类型、最大成员数 |
| `user_groups` | 用户-群组关联 | 用户ID、群组ID、角色 |
| `folders` | 文件夹表 | 名称、父文件夹、所属用户/群组、权限 |
| `files` | 文件表 | 名称、大小、MD5、存储路径、所属文件夹、版本号、软删除标记 |
| `file_versions` | 文件版本表 | 版本号、大小、MD5、存储路径、变更说明 |
| `share_links` | 分享链接表 | 分享码、文件/文件夹ID、密码、过期时间、权限、下载次数 |
| `login_logs` | 登录日志表 | 用户、登录方式、IP、User-Agent、状态 |
| `operation_logs` | 操作日志表 | 用户、操作类型、目标、详情、IP |
| `system_config` | 系统配置表 | 配置键值对 |

### 文件秒传实现原理

1. 用户上传文件时，前端 SparkMD5 分块计算文件完整哈希
2. 系统查询数据库中是否存在相同 MD5 且相同大小的文件
3. 如果存在：直接创建新文件记录，引用已有的存储文件（秒传）
4. 如果不存在：执行普通上传流程，存储文件并记录哈希

## API 接口文档

### 认证接口

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| POST | `/api/auth/register` | 用户注册 | 否 |
| POST | `/api/auth/login` | 密码登录 | 否 |
| POST | `/api/auth/login/email` | 邮箱验证码登录 | 否 |
| POST | `/api/auth/refresh` | 刷新 Token | 否 |
| POST | `/api/auth/forgot-password` | 忘记密码（发送重置链接） | 否 |
| POST | `/api/auth/reset-password` | 重置密码 | 否 |
| POST | `/api/auth/send-code` | 发送邮箱验证码 | 否 |
| GET | `/api/auth/me` | 获取当前用户信息 | 是 |
| PUT | `/api/auth/password` | 修改密码 | 是 |

### 文件接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/files` | 获取文件列表 |
| POST | `/api/files/upload` | 上传文件 |
| POST | `/api/files/check-hash` | 检查文件哈希（秒传） |
| POST | `/api/files/instant` | 秒传接口 |
| GET | `/api/files/download/:id` | 下载文件 |
| GET | `/api/files/preview/:id` | 预览文件 |
| PUT | `/api/files/save/:id` | 保存编辑内容 |
| PUT | `/api/files/rename/:id` | 重命名 |
| PUT | `/api/files/move/:id` | 移动文件 |
| POST | `/api/files/copy/:id` | 复制文件 |
| POST | `/api/files/batch-delete` | 批量删除 |
| DELETE | `/api/files/:id` | 删除文件 |
| DELETE | `/api/files/folders/:id` | 删除文件夹 |
| GET | `/api/files/download/:id` | 下载文件 |
| GET | `/api/files/folders/download/:id` | 下载文件夹（ZIP 打包） |

#### 分享接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/files/share/:id` | 生成文件分享链接 |
| POST | `/api/files/share-folder/:id` | 生成文件夹分享链接 |
| GET | `/api/files/shared` | 获取我的分享列表 |
| DELETE | `/api/files/share/:id` | 取消分享 |

#### 回收站接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/files/trash` | 获取回收站文件列表 |
| POST | `/api/files/trash/restore/:id` | 恢复单个文件 |
| POST | `/api/files/trash/restore-all` | 一键恢复所有 |
| DELETE | `/api/files/trash/:id` | 永久删除单个文件 |
| DELETE | `/api/files/trash/empty` | 清空回收站 |

#### 版本历史接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/files/versions/:id` | 获取文件版本列表 |
| POST | `/api/files/versions/rollback/:id` | 回滚到指定版本 |

#### 其他接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/files/search` | 搜索文件 |
| GET | `/api/files/recent` | 最近文件 |
| GET | `/api/files/folders` | 获取文件夹列表（树形结构） |
| POST | `/api/files/folders` | 创建文件夹 |
| GET | `/api/files/storage/stats` | 个人存储统计 |
| GET | `/api/files/storage/group-stats/:groupId` | 群组存储统计 |
| GET | `/api/files/stats/folder/:folderId` | 文件夹分析 |

### 公开接口（无需登录）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/s/:code` | 分享页面（文件/文件夹） |
| GET | `/api/public/download/:code` | 公开下载文件 |
| GET | `/api/public/download-folder/:code` | 公开下载文件夹（ZIP） |
| POST | `/api/public/verify-share/:code` | 验证分享密码 |

### 用户/群组管理接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/users` | 用户列表（管理员） |
| POST | `/api/users` | 创建用户（管理员） |
| PUT | `/api/users/:id` | 更新个人信息 |
| PUT | `/api/users/:id/admin` | 管理员更新用户 |
| DELETE | `/api/users/:id` | 删除用户（管理员） |
| GET | `/api/users/logs/operations` | 操作日志列表 |
| GET | `/api/groups` | 群组列表 |
| POST | `/api/groups` | 创建群组 |
| GET | `/api/groups/:id` | 群组详情 |
| PUT | `/api/groups/:id` | 更新群组 |
| DELETE | `/api/groups/:id` | 删除群组 |
| POST | `/api/groups/:id/join` | 加入群组 |
| POST | `/api/groups/:id/leave` | 退出群组 |
| POST | `/api/groups/:id/members` | 管理成员（添加/移除/设置角色） |

## 部署指南

### 生产环境部署

```bash
# 安装 PM2 进程管理
npm install -g pm2

# 启动服务（使用 PM2 配置文件）
pm2 start ecosystem.config.js --env production

# 设置开机自启
pm2 startup
pm2 save
```

### 配置 HTTPS

项目内置 HTTPS 支持，使用 mkcert 生成本地可信证书：

```bash
# 安装 mkcert 并生成证书
mkcert 192.168.101.26 localhost

# 将生成的 .pem 和 -key.pem 文件放在项目根目录
# 修改 server/config.js 中的 SSL 配置
```

### Nginx 反向代理配置

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 200M;
    }
}
```

### 安全建议

1. 修改默认管理员密码
2. 配置 HTTPS 证书
3. 修改 `config.js` 中的 `jwt.secret` 为随机字符串
4. 设置环境变量 `JWT_SECRET` 覆盖默认密钥
5. 配置数据库访问白名单
6. 启用验证码功能（`config.captcha.enabled = true`）
7. 定期备份数据库
8. 配置防火墙限制访问端口

## 常见问题

**Q: 启动后访问页面空白？**
A: 检查 MySQL 数据库连接配置是否正确，确认数据库已初始化。

**Q: 上传文件提示大小超限？**
A: 修改 `server/config.js` 中的 `maxFileSize` 配置项。

**Q: 如何增加用户存储空间？**
A: 管理员在用户管理中修改用户的存储配额即可。

**Q: 文件秒传不生效？**
A: 秒传基于 MD5 哈希匹配，需要上传过的文件才能触发秒传。

**Q: 浏览器显示"此站点连接不安全"？**
A: 使用 mkcert 生成证书并配置 HTTPS，详见部署指南。

**Q: 分享链接提示密码错误？**
A: 分享密码使用 bcrypt 加密后存储，无法找回，需要重新生成分享链接。

**Q: 如何查看操作日志？**
A: 管理员在用户管理页面点击用户行中的"操作日志"按钮查看。

## License

MIT License

---

**企业云盘管理系统** — 安全、高效、易用的企业文件管理解决方案
