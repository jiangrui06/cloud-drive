// ============================================================
// 企业网盘管理系统 - 服务端入口
// Cloud Drive Management System - Server Entry Point
// ============================================================
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const config = require('./config');
const db = require('./models/db');

const app = express();

// ============================================================
// 安全中间件
// ============================================================
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "cdn.bootcdn.net", "cdnjs.cloudflare.com"],
      scriptSrcAttr: null,
      styleSrc: ["'self'", "'unsafe-inline'", "cdn.bootcdn.net", "cdnjs.cloudflare.com"],
      fontSrc: ["'self'", "data:", "cdn.bootcdn.net", "cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'", "cdn.bootcdn.net", "cdnjs.cloudflare.com"],
      upgradeInsecureRequests: null
    }
  }
}));
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400
}));

// 全局频率限制
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 429, message: '请求过于频繁，请稍后再试' }
});
app.use(globalLimiter);

// ============================================================
// 常规中间件
// ============================================================
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(morgan('[:date[iso]] :method :url :status :res[content-length] - :response-time ms'));

// 静态文件服务
app.use(express.static(path.join(__dirname, '..', 'public')));

// ============================================================
// API 路由
// ============================================================

// 认证路由（带登录频率限制）
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 429, message: '登录尝试过于频繁，请15分钟后再试' }
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
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
      `SELECT sl.*, f.name, f.size, f.extension, f.storage_path, f.mime_type, f.id as file_id
       FROM share_links sl
       LEFT JOIN files f ON sl.file_id = f.id
       WHERE sl.code = ? AND sl.status = 1 AND (sl.expire_time IS NULL OR sl.expire_time > NOW())`,
      [req.params.code]
    );

    if (!link) {
      return res.status(404).sendFile(path.join(__dirname, '..', 'public', 'share-expired.html'));
    }

    // 文件夹分享
    if (link.folder_id) {
      return renderFolderShare(link, req, res);
    }

    const hasPassword = !!link.password;
    const sharePage = `
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
          .password-box { margin-bottom: 20px; }
          .password-box input { text-align: center; letter-spacing: 2px; font-size: 18px; }
          .error-msg { color: #ff4d4f; font-size: 13px; display: none; margin-top: 8px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="share-card">
            <div class="file-icon"><i class="fas ${link.extension && ['jpg','jpeg','png','gif','bmp'].includes(link.extension.replace('.','')) ? 'fa-file-image' : 'fa-file'}"></i></div>
            <div class="file-name">${escapeHtml(link.name)}</div>
            <div class="file-info">${(link.size / 1024 / 1024).toFixed(2)} MB · ${escapeHtml(link.extension || '未知类型')}</div>
            ${hasPassword ? `
            <div class="password-box">
              <p style="font-size:13px;color:#666;margin-bottom:12px;">此文件受密码保护，请输入提取密码</p>
              <input type="password" class="form-control" id="sharePwd" placeholder="请输入提取密码" autocomplete="off">
              <div class="error-msg" id="pwdError">密码错误，请重试</div>
            </div>
            <button class="btn btn-primary btn-lg w-100" id="verifyBtn" onclick="verifyPassword()"><i class="fas fa-unlock me-2"></i>验证密码</button>
            <a href="/api/public/download/${link.code}" class="btn btn-primary btn-lg w-100" id="downloadBtn" style="display:none;">
              <i class="fas fa-download me-2"></i>下载文件
            </a>
            <script>
              async function verifyPassword() {
                const pwd = document.getElementById('sharePwd').value;
                if (!pwd) { document.getElementById('pwdError').style.display = 'block'; return; }
                document.getElementById('verifyBtn').disabled = true;
                document.getElementById('verifyBtn').innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>验证中...';
                try {
                  const resp = await fetch('/api/public/verify-share/${link.code}', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password: pwd })
                  });
                  const result = await resp.json();
                  if (result.code === 200) {
                    document.getElementById('verifyBtn').style.display = 'none';
                    document.getElementById('sharePwd').style.display = 'none';
                    document.querySelector('.password-box p').textContent = '✅ 密码验证成功';
                    const dlBtn = document.getElementById('downloadBtn');
                    dlBtn.href = '/api/public/download/${link.code}?share_token=' + result.data.token;
                    dlBtn.style.display = 'flex';
                  } else {
                    document.getElementById('pwdError').textContent = result.message || '密码错误';
                    document.getElementById('pwdError').style.display = 'block';
                    document.getElementById('verifyBtn').disabled = false;
                    document.getElementById('verifyBtn').innerHTML = '<i class="fas fa-unlock me-2"></i>验证密码';
                  }
                } catch(e) {
                  document.getElementById('pwdError').textContent = '网络错误';
                  document.getElementById('pwdError').style.display = 'block';
                  document.getElementById('verifyBtn').disabled = false;
                  document.getElementById('verifyBtn').innerHTML = '<i class="fas fa-unlock me-2"></i>验证密码';
                }
              }
            </script>
            ` : `
            <a href="/api/public/download/${link.code}" class="btn btn-primary btn-lg w-100">
              <i class="fas fa-download me-2"></i>下载文件
            </a>
            `}
          </div>
        </div>
      </body>
      </html>
    `;
    res.send(sharePage);
  } catch (err) {
    console.error('[Share] 分享页面错误:', err);
    res.status(500).send('服务器错误');
  }
});

// 文件夹分享渲染
async function renderFolderShare(link, req, res) {
  try {
    const files = await db.query(
      `SELECT id, name, size, extension, mime_type, updated_at FROM files
       WHERE folder_id = ? AND is_deleted = 0 ORDER BY name ASC`,
      [link.folder_id]
    );

    const hasPassword = !!link.password;
    const fileRows = files.map(f =>
      `<tr>
        <td><i class="fas ${f.extension && ['jpg','jpeg','png','gif','bmp'].includes(f.extension.replace('.','')) ? 'fa-file-image' : 'fa-file'} me-2" style="color:#1890ff;"></i>${escapeHtml(f.name)}</td>
        <td>${(f.size / 1024 / 1024).toFixed(2)} MB</td>
        <td>${f.extension || '未知'}</td>
      </tr>`
    ).join('');

    const page = `
      <!DOCTYPE html>
      <html lang="zh-CN">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>分享文件夹 - 企业云盘</title>
        <link href="https://cdn.bootcdn.net/ajax/libs/twitter-bootstrap/5.3.1/css/bootstrap.min.css" rel="stylesheet">
        <link href="https://cdn.bootcdn.net/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
        <style>
          body { background: #f0f2f5; padding: 40px 20px; }
          .share-card { background: #fff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,.08); padding: 40px; max-width: 600px; margin: 0 auto; text-align: center; }
          .file-icon { font-size: 64px; color: #ffc107; margin-bottom: 20px; }
          .folder-name { font-size: 18px; font-weight: 600; margin-bottom: 8px; }
          .file-count { color: #666; margin-bottom: 24px; font-size: 14px; }
          .file-list { text-align: left; margin-top: 20px; }
          .file-list table { width: 100%; font-size: 13px; }
          .file-list th { padding: 8px 12px; background: #fafafa; border-bottom: 1px solid #e8e8e8; font-weight: 600; }
          .file-list td { padding: 8px 12px; border-bottom: 1px solid #f0f0f0; }
          .password-box { margin-bottom: 20px; max-width: 300px; margin-left: auto; margin-right: auto; }
          .password-box input { text-align: center; letter-spacing: 2px; font-size: 18px; }
          .error-msg { color: #ff4d4f; font-size: 13px; display: none; margin-top: 8px; }
          .download-all { margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="share-card">
            <div class="file-icon"><i class="fas fa-folder"></i></div>
            <div class="folder-name">${escapeHtml(link.name)}</div>
            <div class="file-count">共 ${files.length} 个文件</div>
            ${hasPassword ? `
            <div class="password-box">
              <p style="font-size:13px;color:#666;margin-bottom:12px;">此文件夹受密码保护，请输入提取密码</p>
              <input type="password" class="form-control" id="sharePwd" placeholder="请输入提取密码" autocomplete="off">
              <div class="error-msg" id="pwdError">密码错误，请重试</div>
            </div>
            <button class="btn btn-primary btn-lg" id="verifyBtn" onclick="verifyFolderPassword()"><i class="fas fa-unlock me-2"></i>验证密码</button>
            <div id="fileContent" style="display:none;">
              <div class="file-list"><table><thead><tr><th>文件名</th><th>大小</th><th>类型</th></tr></thead><tbody>${fileRows}</tbody></table></div>
              <div class="download-all"><a href="/api/public/download-folder/${link.code}" class="btn btn-primary w-100" id="dlAllBtn"><i class="fas fa-download me-2"></i>全部下载 (ZIP)</a></div>
            </div>
            <script>
              async function verifyFolderPassword() {
                const pwd = document.getElementById('sharePwd').value;
                if (!pwd) { document.getElementById('pwdError').style.display = 'block'; return; }
                document.getElementById('verifyBtn').disabled = true;
                document.getElementById('verifyBtn').innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>验证中...';
                try {
                  const resp = await fetch('/api/public/verify-share/${link.code}', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password: pwd })
                  });
                  const result = await resp.json();
                  if (result.code === 200) {
                    document.getElementById('verifyBtn').style.display = 'none';
                    document.getElementById('sharePwd').style.display = 'none';
                    document.querySelector('.password-box p').textContent = '✅ 密码验证成功';
                    document.getElementById('fileContent').style.display = 'block';
                    document.getElementById('dlAllBtn').href = '/api/public/download-folder/${link.code}?share_token=' + result.data.token;
                    // 为单个文件添加token
                    document.querySelectorAll('.dl-single').forEach(a => {
                      a.href += '?share_token=' + result.data.token;
                    });
                  } else {
                    document.getElementById('pwdError').textContent = result.message || '密码错误';
                    document.getElementById('pwdError').style.display = 'block';
                    document.getElementById('verifyBtn').disabled = false;
                    document.getElementById('verifyBtn').innerHTML = '<i class="fas fa-unlock me-2"></i>验证密码';
                  }
                } catch(e) {
                  document.getElementById('pwdError').textContent = '网络错误';
                  document.getElementById('pwdError').style.display = 'block';
                  document.getElementById('verifyBtn').disabled = false;
                  document.getElementById('verifyBtn').innerHTML = '<i class="fas fa-unlock me-2"></i>验证密码';
                }
              }
            </script>
            ` : `
            <div class="file-list"><table><thead><tr><th>文件名</th><th>大小</th><th>类型</th></tr></thead><tbody>${fileRows}</tbody></table></div>
            <div class="download-all"><a href="/api/public/download-folder/${link.code}" class="btn btn-primary w-100"><i class="fas fa-download me-2"></i>全部下载 (ZIP)</a></div>
            `}
          </div>
        </div>
      </body>
      </html>
    `;
    res.send(page);
  } catch (err) {
    console.error('[Share] 文件夹分享页面错误:', err);
    res.status(500).send('服务器错误');
  }
}

// 公开验证分享密码
app.post('/api/public/verify-share/:code', async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ code: 400, message: '请输入提取密码' });
    }

    const link = await db.queryOne(
      `SELECT * FROM share_links WHERE code = ? AND status = 1 AND (expire_time IS NULL OR expire_time > NOW())`,
      [req.params.code]
    );

    if (!link) return res.status(404).json({ code: 404, message: '分享链接无效或已过期' });

    if (!link.password) {
      return res.json({ code: 200, message: '无需密码', data: { token: null } });
    }

    const bcrypt = require('bcryptjs');
    const isMatch = await bcrypt.compare(password, link.password);
    if (!isMatch) {
      return res.status(403).json({ code: 403, message: '提取密码错误' });
    }

    // 生成短期分享令牌
    const jwt = require('jsonwebtoken');
    const token = jwt.sign(
      { code: link.code, type: 'share_download', file_id: link.file_id, folder_id: link.folder_id },
      config.jwt.secret,
      { expiresIn: '1h' }
    );

    res.json({ code: 200, message: '验证成功', data: { token } });
  } catch (err) {
    console.error('[Share] 验证密码失败:', err);
    res.status(500).json({ code: 500, message: '服务器错误' });
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

    // 检查密码：有密码的分享需要 share_token
    if (link.password) {
      const shareToken = req.query.share_token;
      if (!shareToken) {
        return res.status(403).json({ code: 403, message: '此文件受密码保护，请先验证密码' });
      }
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(shareToken, config.jwt.secret);
        if (decoded.type !== 'share_download' || decoded.code !== link.code) {
          return res.status(403).json({ code: 403, message: '分享令牌无效' });
        }
      } catch (err) {
        return res.status(403).json({ code: 403, message: '分享令牌已过期或无效' });
      }
    }

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

// 公开下载文件夹（通过分享码打包ZIP）
app.get('/api/public/download-folder/:code', async (req, res) => {
  try {
    const link = await db.queryOne(
      `SELECT sl.*, f.name FROM share_links sl
       LEFT JOIN folders f ON sl.folder_id = f.id
       WHERE sl.code = ? AND sl.status = 1 AND (sl.expire_time IS NULL OR sl.expire_time > NOW())`,
      [req.params.code]
    );

    if (!link || !link.folder_id) return res.status(404).json({ code: 404, message: '分享链接无效' });

    // 检查密码
    if (link.password) {
      const shareToken = req.query.share_token;
      if (!shareToken) {
        return res.status(403).json({ code: 403, message: '此文件夹受密码保护，请先验证密码' });
      }
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(shareToken, config.jwt.secret);
        if (decoded.type !== 'share_download' || decoded.code !== link.code) {
          return res.status(403).json({ code: 403, message: '分享令牌无效' });
        }
      } catch (err) {
        return res.status(403).json({ code: 403, message: '分享令牌已过期或无效' });
      }
    }

    // 获取文件夹内文件
    const files = await db.query(
      `SELECT name, storage_path FROM files WHERE folder_id = ? AND is_deleted = 0`,
      [link.folder_id]
    );

    if (files.length === 0) {
      return res.status(404).json({ code: 404, message: '文件夹为空' });
    }

    const zipName = encodeURIComponent(link.name || 'folder') + '.zip';
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"; filename*=UTF-8''${zipName}`);

    const archiver = require('archiver');
    const archive = new archiver.ZipArchive();
    archive.pipe(res);

    files.forEach(f => {
      const filePath = path.join(config.storage.root, f.storage_path);
      if (fs.existsSync(filePath)) {
        archive.file(filePath, { name: f.name });
      }
    });

    await archive.finalize();
  } catch (err) {
    console.error('[Share] 下载文件夹失败:', err);
    if (!res.headersSent) {
      res.status(500).json({ code: 500, message: '下载失败' });
    }
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
// HTML转义函数
// ============================================================
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ============================================================
// SSL 配置
// ============================================================
const sslCertPath = path.join(__dirname, '..', config.ssl?.cert || '');
const sslKeyPath = path.join(__dirname, '..', config.ssl?.key || '');
const hasSSL = config.ssl?.enabled && fs.existsSync(sslCertPath) && fs.existsSync(sslKeyPath);

// ============================================================
// 启动服务器
// ============================================================
const PORT = config.port;

function startServers() {
  const servers = [];

  // HTTP 服务器
  const httpServer = http.createServer(app);
  httpServer.listen(PORT, () => {
    console.log(`  HTTP:  http://localhost:${PORT}`);
  });
  servers.push(httpServer);

  // HTTPS 服务器
  if (hasSSL) {
    const sslOptions = {
      key: fs.readFileSync(sslKeyPath),
      cert: fs.readFileSync(sslCertPath)
    };
    const SSL_PORT = config.ssl?.port || 3443;
    const httpsServer = https.createServer(sslOptions, app);
    httpsServer.listen(SSL_PORT, () => {
      console.log(`  HTTPS: https://localhost:${SSL_PORT}`);
    });
    servers.push(httpsServer);
  }

  console.log('============================================');
  console.log('  企业网盘管理系统 v1.0.0');
  console.log('  Cloud Drive Management System');
  console.log('============================================');
  console.log(`  HTTP:  http://192.168.101.26:${PORT}`);
  if (hasSSL) {
    console.log(`  HTTPS: https://192.168.101.26:${config.ssl.port}`);
  }
  console.log(`  API地址:  http://localhost:${PORT}/api`);
  console.log(`  管理后台: http://localhost:${PORT}/admin`);
  console.log(`  运行环境: ${process.env.NODE_ENV || 'development'}`);
  console.log(`  SSL: ${hasSSL ? '已启用' : '未配置'}`);
  console.log('============================================');
  console.log(`  启动时间: ${new Date().toLocaleString('zh-CN')}`);
  console.log('============================================');
  if (process.send) process.send('ready');
  return servers;
}

const servers = startServers();

function gracefulShutdown(signal) {
  console.log(`\n[Server] 收到 ${signal}，开始优雅关闭...`);
  let closed = 0;
  const total = servers.length;
  servers.forEach(s => {
    s.close(async () => {
      closed++;
      if (closed === total) {
        try {
          await db.pool.end();
          console.log('[Server] 数据库连接已关闭');
        } catch (err) {
          console.error('[Server] 关闭数据库连接失败:', err.message);
        }
        console.log('[Server] 服务已停止');
        process.exit(0);
      }
    });
  });
  // 30秒超时强制退出
  setTimeout(() => {
    console.error('[Server] 强制关闭超时');
    process.exit(1);
  }, 3000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = app;
