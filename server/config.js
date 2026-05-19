// ============================================================
// 网盘管理系统 - 配置文件
// ============================================================
const path = require('path');

module.exports = {
  // 服务端口
  port: process.env.PORT || 3000,

  // 数据库配置
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
    database: process.env.DB_NAME || 'cloud_drive',
    waitForConnections: true,
    connectionLimit: 20,
    queueLimit: 0,
    charset: 'utf8mb4'
  },

  // JWT配置
  jwt: {
    secret: process.env.JWT_SECRET || 'cloud-drive-jwt-secret-key-2024',
    expiresIn: '7d',
    refreshExpiresIn: '30d'
  },

  // 文件存储配置
  storage: {
    root: path.join(__dirname, '..', 'storage'),
    maxFileSize: 100 * 1024 * 1024, // 100MB
    allowedExtensions: 'jpg,jpeg,png,gif,bmp,doc,docx,xls,xlsx,ppt,pptx,pdf,txt,zip,rar,7z,mp4,mp3,avi,wav,js,py,html,css,json,xml,md,csv',
    chunkSize: 1024 * 1024 // 分片上传: 1MB/片
  },

  // 加密配置
  encryption: {
    bcryptRounds: 10
  },

  // 验证码配置
  captcha: {
    enabled: false,      // 生产环境启用
    expireIn: 300        // 5分钟有效
  }
};
