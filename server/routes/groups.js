// ============================================================
// 群组管理路由
// ============================================================
const express = require('express');
const router = express.Router();
const db = require('../models/db');
const { authenticate, requireAdmin, logOperation } = require('../middleware/auth');

// --------------- 获取群组列表 ---------------
router.get('/', authenticate, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 20;
    const offset = (page - 1) * pageSize;
    const keyword = req.query.keyword || '';

    let where = 'WHERE 1=1';
    const params = [];

    // 非管理员只能看到自己加入的群组
    if (req.user.role !== 'admin') {
      where += ' AND (g.owner_id = ? OR g.id IN (SELECT group_id FROM user_groups WHERE user_id = ?))';
      params.push(req.user.id, req.user.id);
    }

    if (keyword) {
      where += ' AND g.name LIKE ?';
      params.push(`%${keyword}%`);
    }

    const countResult = await db.queryOne(
      `SELECT COUNT(*) as total FROM \`groups\` g ${where}`, params
    );

    const groups = await db.query(
      `SELECT g.*, u.username as owner_name,
       (SELECT COUNT(*) FROM user_groups ug WHERE ug.group_id = g.id) as member_count
       FROM \`groups\` g
       LEFT JOIN users u ON g.owner_id = u.id
       ${where}
       ORDER BY g.created_at DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    // 获取每个群组中当前用户的角色
    if (req.user.id) {
      for (const group of groups) {
        const membership = await db.queryOne(
          'SELECT role FROM user_groups WHERE user_id = ? AND group_id = ?',
          [req.user.id, group.id]
        );
        group.my_role = membership ? membership.role : null;
      }
    }

    res.json({
      code: 200,
      data: {
        list: groups,
        pagination: { page, pageSize, total: countResult.total, totalPages: Math.ceil(countResult.total / pageSize) }
      }
    });
  } catch (err) {
    console.error('[Groups] 获取列表失败:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// --------------- 获取单个群组 ---------------
router.get('/:id', authenticate, async (req, res) => {
  try {
    const groupId = parseInt(req.params.id);
    const group = await db.queryOne(
      `SELECT g.*, u.username as owner_name FROM \`groups\` g LEFT JOIN users u ON g.owner_id = u.id WHERE g.id = ?`,
      [groupId]
    );
    if (!group) {
      return res.status(404).json({ code: 404, message: '群组不存在' });
    }

    // 获取成员列表
    const members = await db.query(
      `SELECT u.id, u.username, u.nickname, u.email, u.avatar, ug.role, ug.joined_at
       FROM user_groups ug JOIN users u ON ug.user_id = u.id
       WHERE ug.group_id = ? ORDER BY ug.joined_at ASC`,
      [groupId]
    );

    group.members = members;
    group.member_count = members.length;

    res.json({ code: 200, data: group });
  } catch (err) {
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// --------------- 创建群组 ---------------
router.post('/', authenticate, logOperation('create_group'), async (req, res) => {
  try {
    const { name, description, type, max_members } = req.body;
    if (!name) {
      return res.status(400).json({ code: 400, message: '群组名称不能为空' });
    }

    // 检查同名群组
    const existing = await db.queryOne('SELECT id FROM `groups` WHERE name = ?', [name]);
    if (existing) {
      return res.status(409).json({ code: 409, message: '群组名称已存在' });
    }

    const groupId = await db.insert(
      'INSERT INTO `groups` (name, description, owner_id, type, max_members) VALUES (?, ?, ?, ?, ?)',
      [name, description || null, req.user.id, type || 'private', max_members || 50]
    );

    // 创建者自动成为群主
    await db.insert(
      'INSERT INTO user_groups (user_id, group_id, role) VALUES (?, ?, ?)',
      [req.user.id, groupId, 'owner']
    );

    // 创建群组共享文件夹
    await db.insert(
      'INSERT INTO folders (name, parent_id, owner_id, group_id, is_shared, permission) VALUES (?, NULL, ?, ?, 1, ?)',
      [name, req.user.id, groupId, 'group']
    );

    res.status(201).json({ code: 201, message: '群组创建成功', data: { id: groupId } });
  } catch (err) {
    console.error('[Groups] 创建失败:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// --------------- 更新群组 ---------------
router.put('/:id', authenticate, logOperation('update_group'), async (req, res) => {
  try {
    const groupId = parseInt(req.params.id);
    const { name, description, type, max_members } = req.body;

    const group = await db.queryOne('SELECT * FROM `groups` WHERE id = ?', [groupId]);
    if (!group) return res.status(404).json({ code: 404, message: '群组不存在' });

    // 权限检查：群主或管理员
    if (req.user.role !== 'admin' && group.owner_id !== req.user.id) {
      return res.status(403).json({ code: 403, message: '无权限修改群组信息' });
    }

    const updates = [];
    const params = [];
    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (description !== undefined) { updates.push('description = ?'); params.push(description); }
    if (type !== undefined) { updates.push('type = ?'); params.push(type); }
    if (max_members !== undefined) { updates.push('max_members = ?'); params.push(max_members); }

    if (updates.length > 0) {
      params.push(groupId);
      await db.update(`UPDATE \`groups\` SET ${updates.join(', ')} WHERE id = ?`, params);
    }

    res.json({ code: 200, message: '群组信息已更新' });
  } catch (err) {
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// --------------- 删除群组 ---------------
router.delete('/:id', authenticate, logOperation('delete_group'), async (req, res) => {
  try {
    const groupId = parseInt(req.params.id);
    const group = await db.queryOne('SELECT * FROM `groups` WHERE id = ?', [groupId]);
    if (!group) return res.status(404).json({ code: 404, message: '群组不存在' });

    if (req.user.role !== 'admin' && group.owner_id !== req.user.id) {
      return res.status(403).json({ code: 403, message: '无权限删除群组' });
    }

    await db.update('UPDATE `groups` SET status = 0 WHERE id = ?', [groupId]);
    res.json({ code: 200, message: '群组已删除' });
  } catch (err) {
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// --------------- 加入群组 ---------------
router.post('/:id/join', authenticate, async (req, res) => {
  try {
    const groupId = parseInt(req.params.id);
    const group = await db.queryOne('SELECT * FROM `groups` WHERE id = ? AND status = 1', [groupId]);
    if (!group) return res.status(404).json({ code: 404, message: '群组不存在或已禁用' });

    // 检查成员数上限
    const memberCount = await db.queryOne('SELECT COUNT(*) as count FROM user_groups WHERE group_id = ?', [groupId]);
    if (memberCount.count >= group.max_members) {
      return res.status(400).json({ code: 400, message: '群组成员已满' });
    }

    // 检查是否已在群组中
    const existing = await db.queryOne('SELECT id FROM user_groups WHERE user_id = ? AND group_id = ?', [req.user.id, groupId]);
    if (existing) {
      return res.status(409).json({ code: 409, message: '您已经是该群组成员' });
    }

    await db.insert('INSERT INTO user_groups (user_id, group_id, role) VALUES (?, ?, ?)', [req.user.id, groupId, 'member']);
    res.json({ code: 200, message: '已加入群组' });
  } catch (err) {
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// --------------- 退出群组 ---------------
router.post('/:id/leave', authenticate, async (req, res) => {
  try {
    const groupId = parseInt(req.params.id);
    const membership = await db.queryOne('SELECT * FROM user_groups WHERE user_id = ? AND group_id = ?', [req.user.id, groupId]);
    if (!membership) {
      return res.status(400).json({ code: 400, message: '您不是该群组成员' });
    }
    if (membership.role === 'owner') {
      return res.status(400).json({ code: 400, message: '群主不能退出群组，请先转让群主身份' });
    }

    await db.update('DELETE FROM user_groups WHERE user_id = ? AND group_id = ?', [req.user.id, groupId]);
    res.json({ code: 200, message: '已退出群组' });
  } catch (err) {
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// --------------- 管理群组成员（添加/移除/改角色） ---------------
router.post('/:id/members', authenticate, logOperation('manage_group_member'), async (req, res) => {
  try {
    const groupId = parseInt(req.params.id);
    const { userId, action, role } = req.body; // action: add, remove, setRole

    const group = await db.queryOne('SELECT * FROM `groups` WHERE id = ?', [groupId]);
    if (!group) return res.status(404).json({ code: 404, message: '群组不存在' });

    // 权限检查
    const myMembership = await db.queryOne('SELECT * FROM user_groups WHERE user_id = ? AND group_id = ?', [req.user.id, groupId]);
    const isAdmin = req.user.role === 'admin';
    if (!isAdmin && (!myMembership || (myMembership.role !== 'owner' && myMembership.role !== 'admin'))) {
      return res.status(403).json({ code: 403, message: '无权限管理群组成员' });
    }

    switch (action) {
      case 'add': {
        // 检查用户是否存在
        const targetUser = await db.queryOne('SELECT id, username FROM users WHERE id = ?', [userId]);
        if (!targetUser) {
          return res.status(400).json({ code: 400, message: '用户不存在' });
        }
        const memberCount = await db.queryOne('SELECT COUNT(*) as count FROM user_groups WHERE group_id = ?', [groupId]);
        if (memberCount.count >= group.max_members) {
          return res.status(400).json({ code: 400, message: '群组成员已满' });
        }
        const existing = await db.queryOne('SELECT id FROM user_groups WHERE user_id = ? AND group_id = ?', [userId, groupId]);
        if (existing) return res.status(409).json({ code: 409, message: '该用户已是群组成员' });
        await db.insert('INSERT INTO user_groups (user_id, group_id, role) VALUES (?, ?, ?)', [userId, groupId, role || 'member']);
        res.json({ code: 200, message: '成员已添加' });
        break;
      }
      case 'remove': {
        if (userId === group.owner_id) return res.status(400).json({ code: 400, message: '不能移除群主' });
        await db.update('DELETE FROM user_groups WHERE user_id = ? AND group_id = ?', [userId, groupId]);
        res.json({ code: 200, message: '成员已移除' });
        break;
      }
      case 'setRole': {
        if (userId === group.owner_id) return res.status(400).json({ code: 400, message: '不能修改群主的角色' });
        await db.update('UPDATE user_groups SET role = ? WHERE user_id = ? AND group_id = ?', [role, userId, groupId]);
        res.json({ code: 200, message: '角色已更新' });
        break;
      }
      default:
        res.status(400).json({ code: 400, message: '无效的操作' });
    }
  } catch (err) {
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

module.exports = router;
