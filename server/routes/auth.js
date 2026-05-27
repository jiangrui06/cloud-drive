// ============================================================
// 认证路由 - 支持多种登录方式
// ============================================================
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const router = express.Router();
const db = require('../models/db');
const config = require('../config');
const { authenticate } = require('../middleware/auth');

// --------------- 用户注册 ---------------
router.post('/register', async (req, res) => {
  try {
    const { username, password, email, phone, nickname } = req.body;

    // 参数验证
    if (!username || !password) {
      return res.status(400).json({ code: 400, message: '用户名和密码不能为空' });
    }
    if (username.length < 3 || username.length > 50) {
      return res.status(400).json({ code: 400, message: '用户名长度在3-50个字符之间' });
    }
    if (password.length < 6) {
      return res.status(400).json({ code: 400, message: '密码长度不能少于6位' });
    }

    // 检查用户名唯一性
    const existing = await db.queryOne('SELECT id FROM users WHERE username = ?', [username]);
    if (existing) {
      return res.status(409).json({ code: 409, message: '用户名已存在' });
    }

    // 检查邮箱唯一性
    if (email) {
      const emailExist = await db.queryOne('SELECT id FROM users WHERE email = ?', [email]);
      if (emailExist) {
        return res.status(409).json({ code: 409, message: '邮箱已被注册' });
      }
    }

    // 检查手机号唯一性
    if (phone) {
      const phoneExist = await db.queryOne('SELECT id FROM users WHERE phone = ?', [phone]);
      if (phoneExist) {
        return res.status(409).json({ code: 409, message: '手机号已被注册' });
      }
    }

    // 加密密码
    const hashedPassword = await bcrypt.hash(password, config.encryption.bcryptRounds);

    // 使用事务：创建用户 + 创建根目录
    const conn = await db.beginTransaction();
    let userId;
    try {
      userId = await db.insertWithConn(conn,
        'INSERT INTO users (username, password, email, phone, nickname) VALUES (?, ?, ?, ?, ?)',
        [username, hashedPassword, email || null, phone || null, nickname || username]
      );

      await db.insertWithConn(conn,
        'INSERT INTO folders (name, parent_id, owner_id) VALUES (?, NULL, ?)',
        ['我的文件', userId]
      );

      await conn.commit();
    } catch (txErr) {
      await conn.rollback();
      throw txErr; // 交给外层 catch 处理
    }

    // 记录注册日志
    await db.insert(
      'INSERT INTO operation_logs (user_id, username, action, target_type, target_id, target_name, ip_address, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [userId, username, 'register', 'user', userId, username, req.ip, JSON.stringify({ method: 'register' })]
    );

    // 生成JWT
    const token = jwt.sign(
      { id: userId, username, role: 'user' },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );

    res.status(201).json({
      code: 201,
      message: '注册成功',
      data: { token, user: { id: userId, username, nickname: nickname || username, email, phone, role: 'user' } }
    });
  } catch (err) {
    console.error('[Auth] 注册失败:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// --------------- 登录（用户名/邮箱/手机号 + 密码） ---------------
router.post('/login', async (req, res) => {
  try {
    const { account, password, loginMethod } = req.body;

    if (!account || !password) {
      return res.status(400).json({ code: 400, message: '账号和密码不能为空' });
    }

    let user = null;
    let method = loginMethod;

    // 自动检测登录方式
    if (!method) {
      method = account.includes('@') ? 'email' : 'password';
    }

    if (method === 'email') {
      user = await db.queryOne('SELECT * FROM users WHERE email = ? AND status = 1', [account]);
    } else if (method === 'phone') {
      user = await db.queryOne('SELECT * FROM users WHERE phone = ? AND status = 1', [account]);
    } else {
      user = await db.queryOne('SELECT * FROM users WHERE username = ? AND status = 1', [account]);
    }

    if (!user) {
      await db.insert(
        'INSERT INTO login_logs (username, login_method, login_ip, user_agent, status, fail_reason) VALUES (?, ?, ?, ?, 0, ?)',
        [account, method, req.ip, req.headers['user-agent'] || null, '账号不存在或已禁用']
      );
      return res.status(401).json({ code: 401, message: '账号不存在或已禁用' });
    }

    // 验证密码
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      await db.insert(
        'INSERT INTO login_logs (username, login_method, login_ip, user_agent, status, fail_reason) VALUES (?, ?, ?, ?, 0, ?)',
        [account, method, req.ip, req.headers['user-agent'] || null, '密码错误']
      );
      return res.status(401).json({ code: 401, message: '密码错误' });
    }

    // 更新登录信息
    await db.update(
      'UPDATE users SET last_login = NOW(), login_ip = ? WHERE id = ?',
      [req.ip, user.id]
    );

    // 记录登录成功日志
    await db.insert(
      'INSERT INTO login_logs (user_id, username, login_method, login_ip, user_agent, status) VALUES (?, ?, ?, ?, ?, 1)',
      [user.id, user.username, method, req.ip, req.headers['user-agent'] || null]
    );

    // 生成JWT
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );

    // 生成刷新令牌
    const refreshToken = jwt.sign(
      { id: user.id, type: 'refresh' },
      config.jwt.secret,
      { expiresIn: config.jwt.refreshExpiresIn }
    );

    res.json({
      code: 200,
      message: '登录成功',
      data: {
        token,
        refreshToken,
        user: {
          id: user.id,
          username: user.username,
          nickname: user.nickname || user.username,
          email: user.email,
          phone: user.phone,
          role: user.role,
          avatar: user.avatar,
          total_storage: user.total_storage,
          used_storage: user.used_storage,
          last_login: user.last_login
        }
      }
    });
  } catch (err) {
    console.error('[Auth] 登录失败:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// 验证码存储（内存） - 生产环境应使用 Redis
const captchaStore = new Map();

// 生成随机验证码
function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// --------------- 邮箱验证码登录 ---------------
router.post('/login/email', async (req, res) => {
  try {
    if (!config.captcha.enabled) {
      return res.status(400).json({ code: 400, message: '邮箱验证码登录未启用' });
    }
    const { email, code } = req.body;
    if (!email || !code) {
      return res.status(400).json({ code: 400, message: '邮箱和验证码不能为空' });
    }

    // 验证验证码
    const stored = captchaStore.get(email);
    if (!stored || stored.code !== code) {
      return res.status(400).json({ code: 400, message: '验证码错误或已过期' });
    }
    if (Date.now() > stored.expireAt) {
      captchaStore.delete(email);
      return res.status(400).json({ code: 400, message: '验证码已过期，请重新发送' });
    }
    captchaStore.delete(email); // 验证码一次性使用

    const user = await db.queryOne('SELECT * FROM users WHERE email = ? AND status = 1', [email]);
    if (!user) {
      return res.status(404).json({ code: 404, message: '该邮箱未注册' });
    }

    await db.update('UPDATE users SET last_login = NOW(), login_ip = ? WHERE id = ?', [req.ip, user.id]);

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );

    res.json({
      code: 200,
      message: '登录成功',
      data: { token, user: { id: user.id, username: user.username, role: user.role, email: user.email } }
    });
  } catch (err) {
    console.error('[Auth] 邮箱登录失败:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// --------------- 刷新Token ---------------
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ code: 400, message: '缺少刷新令牌' });
    }

    const decoded = jwt.verify(refreshToken, config.jwt.secret);
    if (decoded.type !== 'refresh') {
      return res.status(401).json({ code: 401, message: '无效的刷新令牌' });
    }

    const user = await db.queryOne('SELECT id, username, role FROM users WHERE id = ? AND status = 1', [decoded.id]);
    if (!user) {
      return res.status(401).json({ code: 401, message: '用户不存在或已禁用' });
    }

    const newToken = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );

    res.json({ code: 200, message: '令牌已刷新', data: { token: newToken } });
  } catch (err) {
    res.status(401).json({ code: 401, message: '刷新令牌已过期，请重新登录' });
  }
});

// --------------- 获取当前用户信息 ---------------
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await db.queryOne(
      'SELECT id, username, nickname, email, phone, avatar, role, status, total_storage, used_storage, last_login, created_at FROM users WHERE id = ?',
      [req.user.id]
    );
    if (!user) {
      return res.status(404).json({ code: 404, message: '用户不存在' });
    }
    res.json({ code: 200, data: user });
  } catch (err) {
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// --------------- 修改密码 ---------------
router.put('/password', authenticate, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ code: 400, message: '旧密码和新密码不能为空' });
    }

    const user = await db.queryOne('SELECT password FROM users WHERE id = ?', [req.user.id]);
    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ code: 400, message: '旧密码错误' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, config.encryption.bcryptRounds);
    await db.update('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, req.user.id]);

    res.json({ code: 200, message: '密码修改成功' });
  } catch (err) {
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// --------------- 发送验证码 ---------------
router.post('/send-code', async (req, res) => {
  try {
    if (!config.captcha.enabled) {
      return res.status(400).json({ code: 400, message: '验证码功能未启用' });
    }
    const { email, phone } = req.body;
    if (!email && !phone) {
      return res.status(400).json({ code: 400, message: '邮箱或手机号不能为空' });
    }

    // 生成验证码并存储（演示环境在控制台打印）
    const code = generateCode();
    const identifier = email || phone;
    captchaStore.set(identifier, { code, expireAt: Date.now() + (config.captcha.expireIn || 300) * 1000 });
    console.log(`[Captcha] 验证码已发送到 ${identifier}: ${code}`);

    res.json({ code: 200, message: '验证码已发送', data: { expire_in: 300 } });
  } catch (err) {
    res.status(500).json({ code: 500, message: '发送失败' });
  }
});

module.exports = router;
