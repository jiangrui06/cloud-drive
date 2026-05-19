// ============================================================
// 企业网盘管理系统 - 服务端入口
// Cloud Drive Management System - Server Entry Point
// ============================================================
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const db = require('./models/db');

const app = express();

// ============================================================
// 中间件
// ============================================================
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(morgan('[:date[iso]] :method :url :status :res[content-length] - :response-time ms'));

// 静态文件服务
app.use(express.static(path.join(__dirname, '..', 'public')));

// ============================================================
// API 路由
// ============================================================
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/groups', require('./routes/groups'));
app.use('/api/files', require('./routes/files'));

// ============================================================
// 健康检查
// ============================================================
app.get('/api/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({
      code: 200,
      message: '服务运行正常',
      data: {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
      }
    });
  } catch (err) {
    res.status(503).json({ code: 503, message: '数据库连接异常', error: err.message });
  }
});

// ============================================================
// 分享链接访问 (公开路由)
// ============================================================
app.get('/s/:code', async (req, res) => {
  try {
    const link = await db.queryOne(
      `SELECT sl.*, f.name, f.size, f.extension, f.storage_path, f.mime_type
       FROM share_links sl
       LEFT JOIN files f ON sl.file_id = f.id
       WHERE sl.code = ? AND sl.status = 1 AND (sl.expire_time IS NULL OR sl.expire_time > NOW())`,
      [req.params.code]
    );

    if (!link) {
      return res.status(404).sendFile(path.join(__dirname, '..', 'public', 'share-expired.html'));
    }

    // 简单分享页面
    res.send(`
      <!DOCTYPE html>
      <html lang="zh-CN">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>分享文件 - 企业云盘</title>
        <link href="https://cdn.bootcdn.net/ajax/libs/twitter-bootstrap/5.3.1/css/bootstrap.min.css" rel="stylesheet">
        <link href="https://cdn.bootcdn.net/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
        <style>
          body { background: #f0f2f5; display: flex; align-items: center; min-height: 100vh; }
          .share-card { background: #fff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,.08); padding: 40px; max-width: 480px; margin: 0 auto; text-align: center; }
          .file-icon { font-size: 64px; color: #1890ff; margin-bottom: 20px; }
          .file-name { font-size: 18px; font-weight: 600; margin-bottom: 8px; }
          .file-info { color: #666; margin-bottom: 24px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="share-card">
            <div class="file-icon"><i class="fas fa-file"></i></div>
            <div class="file-name">${link.name}</div>
            <div class="file-info">${(link.size / 1024 / 1024).toFixed(2)} MB · ${link.extension || '未知类型'}</div>
            <a href="/api/public/download/${link.code}" class="btn btn-primary btn-lg w-100">
              <i class="fas fa-download me-2"></i>下载文件
            </a>
          </div>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send('服务器错误');
  }
});

// 公开下载（通过分享码）
app.get('/api/public/download/:code', async (req, res) => {
  try {
    const link = await db.queryOne(
      `SELECT sl.*, f.name, f.storage_path FROM share_links sl
       LEFT JOIN files f ON sl.file_id = f.id
       WHERE sl.code = ? AND sl.status = 1 AND (sl.expire_time IS NULL OR sl.expire_time > NOW())`,
      [req.params.code]
    );

    if (!link) return res.status(404).json({ code: 404, message: '分享链接无效或已过期' });

    // 检查下载次数
    if (link.max_downloads && link.download_count >= link.max_downloads) {
      return res.status(400).json({ code: 400, message: '下载次数已达上限' });
    }

    const filePath = path.join(config.storage.root, link.storage_path);
    if (!fs.existsSync(filePath)) return res.status(404).json({ code: 404, message: '文件已丢失' });

    // 更新下载计数
    await db.update('UPDATE share_links SET download_count = download_count + 1 WHERE id = ?', [link.id]);
    await db.update('UPDATE files SET download_count = download_count + 1 WHERE id = ?', [link.file_id]);

    res.download(filePath, link.name);
  } catch (err) {
    res.status(500).json({ code: 500, message: '下载失败' });
  }
});

// ============================================================
// SPA fallback - 所有非API/非静态路由返回index.html
// ============================================================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ============================================================
// 错误处理
// ============================================================
app.use((err, req, res, next) => {
  console.error('[Error]', err.stack || err.message || err);
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ code: 413, message: '请求体过大' });
  }
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ code: 400, message: '文件大小超出限制' });
  }
  res.status(err.status || 500).json({
    code: err.status || 500,
    message: err.message || '服务器内部错误'
  });
});

// ============================================================
// 启动服务器
// ============================================================
const PORT = config.port;
app.listen(PORT, () => {
  console.log('============================================');
  console.log('  企业网盘管理系统 v1.0.0');
  console.log('  Cloud Drive Management System');
  console.log('============================================');
  console.log(`  服务地址: http://localhost:${PORT}`);
  console.log(`  API地址:  http://localhost:${PORT}/api`);
  console.log(`  管理后台: http://localhost:${PORT}/admin`);
  console.log(`  运行环境: ${process.env.NODE_ENV || 'development'}`);
  console.log('============================================');
  console.log(`  启动时间: ${new Date().toLocaleString('zh-CN')}`);
  console.log('============================================');
});

module.exports = app;
