// ============================================================
// 认证中间件
// ============================================================
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../models/db');

// 验证JWT Token
async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ code: 401, message: '未提供认证令牌' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    // 验证用户仍然存在且状态正常
    const user = await db.queryOne('SELECT id, role FROM users WHERE id = ? AND status = 1', [decoded.id]);
    if (!user) {
      return res.status(401).json({ code: 401, message: '用户不存在或已被禁用' });
    }
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ code: 401, message: '令牌已过期，请重新登录' });
    }
    return res.status(401).json({ code: 401, message: '无效的认证令牌' });
  }
}

// 验证管理员权限
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ code: 403, message: '需要管理员权限' });
  }
  next();
}

// 可选认证（不强制要求登录）
function optionalAuth(req, res, next) {
  const token = extractToken(req);
  if (token) {
    try {
      const decoded = jwt.verify(token, config.jwt.secret);
      req.user = decoded;
    } catch (err) {
      // Token无效，忽略
    }
  }
  next();
}

// 从请求中提取JWT（支持 Header 或 URL Query）
function extractToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.split(' ')[1];
  }
  if (req.query && req.query.token) {
    return req.query.token;
  }
  return null;
}

// 从请求中提取并验证JWT（支持 Header 或 URL Query）
function authenticateQuery(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ code: 401, message: '未提供认证令牌' });
  }
  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ code: 401, message: '无效的认证令牌' });
  }
}

// 记录操作日志
function logOperation(action) {
  return async (req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = function (body) {
      if (res.statusCode < 400 && req.user) {
        const logData = {
          user_id: req.user.id,
          username: req.user.username,
          action: action,
          target_type: req.body?.target_type || req.params?.target_type || null,
          target_id: req.body?.target_id || req.params?.id || null,
          target_name: req.body?.target_name || null,
          ip_address: req.ip,
          detail: JSON.stringify({
            method: req.method,
            path: req.originalUrl,
            body: req.method === 'POST' ? sanitizeBody(req.body) : undefined
          })
        };
        db.insert(
          'INSERT INTO operation_logs (user_id, username, action, target_type, target_id, target_name, ip_address, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [logData.user_id, logData.username, logData.action, logData.target_type, logData.target_id, logData.target_name, logData.ip_address, logData.detail]
        ).catch(err => console.error('[Audit] 日志记录失败:', err.message));
      }
      return originalJson(body);
    };
    next();
  };
}

function sanitizeBody(body) {
  if (!body) return {};
  const sanitized = { ...body };
  delete sanitized.password;
  delete sanitized.oldPassword;
  delete sanitized.newPassword;
  delete sanitized.token;
  return sanitized;
}

module.exports = { authenticate, requireAdmin, optionalAuth, authenticateQuery, logOperation };
