// ============================================================
// 用户管理路由 - 管理员功能
// ============================================================
const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const db = require('../models/db');
const config = require('../config');
const { authenticate, requireAdmin, logOperation } = require('../middleware/auth');

// --------------- 获取用户列表（管理员） ---------------
router.get('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 20;
    const offset = (page - 1) * pageSize;
    const keyword = req.query.keyword || '';
    const role = req.query.role || '';
    const status = req.query.status;

    let where = 'WHERE 1=1';
    const params = [];

    if (keyword) {
      where += ' AND (username LIKE ? OR email LIKE ? OR nickname LIKE ? OR phone LIKE ?)';
      const kw = `%${keyword}%`;
      params.push(kw, kw, kw, kw);
    }
    if (role) {
      where += ' AND role = ?';
      params.push(role);
    }
    if (status !== undefined && status !== '') {
      where += ' AND status = ?';
      params.push(parseInt(status));
    }

    const countResult = await db.queryOne(`SELECT COUNT(*) as total FROM users ${where}`, params);
    const users = await db.query(
      `SELECT id, username, nickname, email, phone, avatar, role, status, total_storage, used_storage, last_login, created_at, updated_at FROM users ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    res.json({
      code: 200,
      data: {
        list: users,
        pagination: {
          page,
          pageSize,
          total: countResult.total,
          totalPages: Math.ceil(countResult.total / pageSize)
        }
      }
    });
  } catch (err) {
    console.error('[Users] 获取用户列表失败:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// --------------- 获取单个用户 ---------------
router.get('/:id', authenticate, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    // 非管理员只能查看自己的信息
    if (req.user.role !== 'admin' && req.user.id !== userId) {
      return res.status(403).json({ code: 403, message: '无权限查看其他用户信息' });
    }

    const user = await db.queryOne(
      'SELECT id, username, nickname, email, phone, avatar, role, status, total_storage, used_storage, last_login, created_at, updated_at FROM users WHERE id = ?',
      [userId]
    );
    if (!user) {
      return res.status(404).json({ code: 404, message: '用户不存在' });
    }
    res.json({ code: 200, data: user });
  } catch (err) {
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// --------------- 创建用户（管理员） ---------------
router.post('/', authenticate, requireAdmin, logOperation('create_user'), async (req, res) => {
  try {
    const { username, password, email, phone, nickname, role, total_storage } = req.body;
    if (!username || !password) {
      return res.status(400).json({ code: 400, message: '用户名和密码不能为空' });
    }

    const existing = await db.queryOne('SELECT id FROM users WHERE username = ?', [username]);
    if (existing) {
      return res.status(409).json({ code: 409, message: '用户名已存在' });
    }

    const hashedPassword = await bcrypt.hash(password, config.encryption.bcryptRounds);

    // 使用事务：创建用户 + 创建根目录
    const conn = await db.beginTransaction();
    let userId;
    try {
      userId = await db.insertWithConn(conn,
        'INSERT INTO users (username, password, email, phone, nickname, role, total_storage) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [username, hashedPassword, email || null, phone || null, nickname || username, role || 'user', total_storage || config.storage.defaultFileSize]
      );

      await db.insertWithConn(conn,
        'INSERT INTO folders (name, parent_id, owner_id) VALUES (?, NULL, ?)', ['我的文件', userId]
      );

      await conn.commit();
    } catch (txErr) {
      await conn.rollback();
      throw txErr;
    }

    res.status(201).json({ code: 201, message: '用户创建成功', data: { id: userId } });
  } catch (err) {
    console.error('[Users] 创建用户失败:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// --------------- 更新用户 ---------------
router.put('/:id', authenticate, logOperation('update_user'), async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { nickname, email, phone, avatar } = req.body;

    // 非管理员只能更新自己的基本信息
    if (req.user.role !== 'admin' && req.user.id !== userId) {
      return res.status(403).json({ code: 403, message: '无权限修改此用户信息' });
    }

    const updates = [];
    const params = [];
    if (nickname !== undefined) { updates.push('nickname = ?'); params.push(nickname); }
    if (email !== undefined) { updates.push('email = ?'); params.push(email); }
    if (phone !== undefined) { updates.push('phone = ?'); params.push(phone); }
    if (avatar !== undefined) { updates.push('avatar = ?'); params.push(avatar); }

    if (updates.length === 0) {
      return res.status(400).json({ code: 400, message: '没有需要更新的字段' });
    }

    params.push(userId);
    await db.update(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);

    res.json({ code: 200, message: '用户信息已更新' });
  } catch (err) {
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// --------------- 管理员更新用户状态/角色 ---------------
router.put('/:id/admin', authenticate, requireAdmin, logOperation('admin_update_user'), async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { role, status, total_storage } = req.body;

    if (userId === req.user.id && role) {
      return res.status(400).json({ code: 400, message: '不能修改自己的角色' });
    }

    const updates = [];
    const params = [];
    if (role !== undefined) { updates.push('role = ?'); params.push(role); }
    if (status !== undefined) { updates.push('status = ?'); params.push(status); }
    if (total_storage !== undefined) { updates.push('total_storage = ?'); params.push(total_storage); }

    if (updates.length === 0) {
      return res.status(400).json({ code: 400, message: '没有需要更新的字段' });
    }

    params.push(userId);
    await db.update(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);

    res.json({ code: 200, message: '用户状态已更新' });
  } catch (err) {
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// --------------- 删除用户（管理员） ---------------
router.delete('/:id', authenticate, requireAdmin, logOperation('delete_user'), async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    if (userId === req.user.id) {
      return res.status(400).json({ code: 400, message: '不能删除自己的账号' });
    }
    await db.update('UPDATE users SET status = 0 WHERE id = ?', [userId]);
    res.json({ code: 200, message: '用户已禁用' });
  } catch (err) {
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// --------------- 获取操作日志（管理员） ---------------
router.get('/logs/operations', authenticate, requireAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 50;
    const offset = (page - 1) * pageSize;

    const countResult = await db.queryOne('SELECT COUNT(*) as total FROM operation_logs');
    const logs = await db.query(
      'SELECT * FROM operation_logs ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [pageSize, offset]
    );

    res.json({
      code: 200,
      data: {
        list: logs,
        pagination: { page, pageSize, total: countResult.total, totalPages: Math.ceil(countResult.total / pageSize) }
      }
    });
  } catch (err) {
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

module.exports = router;
