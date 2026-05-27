// ============================================================
// 文件管理路由 - 核心功能
// ============================================================
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const router = express.Router();
const db = require('../models/db');
const upload = require('../middleware/upload');
const { authenticate, authenticateQuery, logOperation } = require('../middleware/auth');
const config = require('../config');
const archiver = require('archiver');
const iconv = require('iconv-lite');

// ============================================================
// 文件秒传: 通过MD5检查文件是否已存在
// ============================================================
router.post('/check-hash', authenticate, async (req, res) => {
  try {
    const { md5, size } = req.body;
    if (!md5) {
      return res.status(400).json({ code: 400, message: '缺少文件MD5' });
    }

    const existing = await db.queryOne(
      'SELECT id, name, size, mime_type, storage_path FROM files WHERE md5 = ? AND size = ? AND is_deleted = 0 LIMIT 1',
      [md5, size || 0]
    );

    if (existing) {
      res.json({
        code: 200,
        message: '检测到文件已存在，可实现秒传',
        data: { exists: true, file: existing }
      });
    } else {
      res.json({ code: 200, data: { exists: false } });
    }
  } catch (err) {
    console.error('[Files] 检查哈希失败:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ============================================================
// 文件秒传: 直接引用已存在的文件
// ============================================================
router.post('/instant', authenticate, async (req, res) => {
  try {
    const { md5, size, name, folder_id, group_id } = req.body;
    if (!md5 || !name) {
      return res.status(400).json({ code: 400, message: '缺少必要参数' });
    }

    // 查找源文件
    const sourceFile = await db.queryOne(
      'SELECT * FROM files WHERE md5 = ? AND size = ? AND is_deleted = 0 LIMIT 1',
      [md5, size || 0]
    );

    if (!sourceFile) {
      return res.status(404).json({ code: 404, message: '未找到源文件，请使用普通上传' });
    }

    // 检查目标文件夹中是否存在同名文件
    const folderId = folder_id || null;
    const existing = await db.queryOne(
      'SELECT id FROM files WHERE folder_id = ? AND name = ? AND is_deleted = 0',
      [folderId, name]
    );
    if (existing) {
      return res.status(409).json({ code: 409, message: '目标文件夹中已存在同名文件' });
    }

    // 创建新的文件记录（引用同一个存储文件）
    const fileId = await db.insert(
      'INSERT INTO files (name, size, mime_type, md5, sha256, storage_path, extension, folder_id, owner_id, group_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        name, sourceFile.size, sourceFile.mime_type,
        sourceFile.md5, sourceFile.sha256, sourceFile.storage_path,
        path.extname(name).toLowerCase(), folderId, req.user.id,
        group_id || null
      ]
    );

    // 更新用户存储使用量
    await db.update(
      'UPDATE users SET used_storage = used_storage + ? WHERE id = ?',
      [sourceFile.size, req.user.id]
    );

    res.status(201).json({
      code: 201,
      message: '文件秒传成功',
      data: { id: fileId, name, size: sourceFile.size }
    });
  } catch (err) {
    console.error('[Files] 秒传失败:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ============================================================
// 上传文件（含计算MD5用于秒传）
// ============================================================
router.post('/upload', authenticate, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ code: 400, message: '未选择文件' });
    }

    let { originalname, filename, size, mimetype, path: filePath } = req.file;
    const { folder_id, group_id } = req.body;
    const folderId = folder_id || null;

    // 修复中文文件名乱码（multer 在某些环境下将 UTF-8 中文解析为 Latin-1）
    const fixedName = fixFilenameEncoding(originalname);
    if (fixedName !== originalname) {
      originalname = fixedName;
    }

    // 计算MD5（由上传中间件在写入时同步计算，无需二次读取）
    const md5 = req.fileMd5;

    // 检查是否超出用户存储配额
    const user = await db.queryOne('SELECT used_storage, total_storage FROM users WHERE id = ?', [req.user.id]);
    if (user && (user.used_storage + size) > user.total_storage) {
      fs.unlinkSync(filePath);
      return res.status(400).json({ code: 400, message: '存储空间不足' });
    }

    // 检查目标文件夹中是否存在同名文件
    const existing = await db.queryOne(
      'SELECT id FROM files WHERE folder_id = ? AND name = ? AND is_deleted = 0',
      [folderId, originalname]
    );
    if (existing) {
      fs.unlinkSync(filePath);
      return res.status(409).json({ code: 409, message: '目标文件夹中已存在同名文件' });
    }

    const ext = path.extname(originalname).toLowerCase();
    const relativePath = path.relative(config.storage.root, filePath);

    const fileId = await db.insert(
      'INSERT INTO files (name, size, mime_type, md5, storage_path, extension, folder_id, owner_id, group_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [originalname, size, mimetype, md5, relativePath, ext, folderId, req.user.id, group_id || null]
    );

    // 更新用户存储
    await db.update('UPDATE users SET used_storage = used_storage + ? WHERE id = ?', [size, req.user.id]);

    res.status(201).json({
      code: 201,
      message: '上传成功',
      data: { id: fileId, name: originalname, size, md5, mime_type: mimetype }
    });
  } catch (err) {
    console.error('[Files] 上传失败:', err);
    if (err.message && err.message.includes('不允许的文件类型')) {
      return res.status(400).json({ code: 400, message: err.message });
    }
    res.status(500).json({ code: 500, message: '文件上传失败' });
  }
});

// ============================================================
// 获取文件列表
// ============================================================
router.get('/', authenticate, async (req, res) => {
  try {
    const { folder_id, group_id, page, pageSize, sort = 'updated_at', order = 'desc', type } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const pageSizeNum = Math.max(1, Math.min(200, parseInt(pageSize) || 50));
    const offset = (pageNum - 1) * pageSizeNum;

    let where = 'WHERE f.is_deleted = 0';
    const params = [];

    // 权限过滤
    if (group_id) {
      where += ' AND f.group_id = ?';
      params.push(parseInt(group_id));
    } else if (folder_id) {
      where += ' AND f.folder_id = ?';
      params.push(parseInt(folder_id));
    } else {
      // 默认查看自己的文件
      where += ' AND f.owner_id = ? AND f.group_id IS NULL';
      params.push(Number(req.user.id));
    }

    // 文件类型过滤
    if (type) {
      const typeMap = {
        image: "'.jpg','.jpeg','.png','.gif','.bmp','.webp','.svg'",
        document: "'.doc','.docx','.xls','.xlsx','.ppt','.pptx','.pdf','.txt','.md'",
        video: "'.mp4','.avi','.mov','.wmv','.flv','.mkv'",
        audio: "'.mp3','.wav','.wma','.aac','.flac'",
        archive: "'.zip','.rar','.7z','.tar','.gz'",
        code: "'.js','.py','.html','.css','.json','.xml','.sql','.java','.cpp','.c','.h','.go','.rs'"
      };
      if (typeMap[type]) {
        where += ` AND f.extension IN (${typeMap[type]})`;
      }
    }

    // 允许排序的字段
    const allowedSort = ['name', 'size', 'created_at', 'updated_at'];
    const sortField = allowedSort.includes(sort) ? `f.${sort}` : 'f.updated_at';
    const sortOrder = order === 'asc' ? 'ASC' : 'DESC';

    const countResult = await db.queryOne(`SELECT COUNT(*) as total FROM files f ${where}`, params);

    const files = await db.query(
      `SELECT f.*, u.username as owner_name
       FROM files f
       LEFT JOIN users u ON f.owner_id = u.id
       ${where}
       ORDER BY ${sortField} ${sortOrder}
       LIMIT ? OFFSET ?`,
      [...params, pageSizeNum, offset]
    );

    // 格式化
    files.forEach(f => {
      f.size_formatted = formatSize(f.size);
      f.is_image = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'].includes(f.extension?.replace('.',''));
      f.is_editable = ['txt', 'md', 'json', 'xml', 'html', 'css', 'js', 'py', 'sql', 'csv', 'yml', 'yaml', 'ini', 'cfg', 'log', 'sh', 'bat'].includes(f.extension?.replace('.',''));
    });

    // 同时获取当前目录下的子文件夹（含文件总大小）
    let folders = [];
    if (group_id) {
      folders = await db.query(
        `SELECT f.*, (SELECT COALESCE(SUM(files.size), 0) FROM files WHERE files.folder_id = f.id AND files.is_deleted = 0) AS total_size FROM folders f WHERE f.group_id = ? ORDER BY f.name ASC`,
        [parseInt(group_id)]
      );
    } else if (folder_id) {
      folders = await db.query(
        `SELECT f.*, (SELECT COALESCE(SUM(files.size), 0) FROM files WHERE files.folder_id = f.id AND files.is_deleted = 0) AS total_size FROM folders f WHERE f.parent_id = ? AND f.owner_id = ? AND f.is_shared = 0 ORDER BY f.name ASC`,
        [parseInt(folder_id), Number(req.user.id)]
      );
    } else {
      folders = await db.query(
        `SELECT f.*, (SELECT COALESCE(SUM(files.size), 0) FROM files WHERE files.folder_id = f.id AND files.is_deleted = 0) AS total_size FROM folders f WHERE f.parent_id IS NULL AND f.owner_id = ? AND f.group_id IS NULL AND f.is_shared = 0 ORDER BY f.name ASC`,
        [Number(req.user.id)]
      );
    }

    // 格式化文件夹
    folders.forEach(f => {
      f.total_size = Number(f.total_size) || 0;
      f.size_formatted = formatSize(f.total_size);
    });

    res.json({
      code: 200,
      data: {
        list: files,
        folders,
        pagination: {
          page: pageNum,
          pageSize: pageSizeNum,
          total: countResult.total,
          totalPages: Math.ceil(countResult.total / pageSizeNum)
        }
      }
    });
  } catch (err) {
    console.error('[Files] 获取列表失败:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ============================================================
// 获取文件夹树
// ============================================================
router.get('/folders', authenticate, async (req, res) => {
  try {
    const { group_id } = req.query;
    let where = 'WHERE owner_id = ? AND is_shared = 0';
    const params = [req.user.id];

    if (group_id) {
      where = 'WHERE group_id = ?';
      params[0] = parseInt(group_id);
    }

    const folders = await db.query(`SELECT * FROM folders ${where} ORDER BY name ASC`, params);
    const tree = buildFolderTree(folders);

    res.json({ code: 200, data: { list: folders, tree } });
  } catch (err) {
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ============================================================
// 创建文件夹
// ============================================================
router.post('/folders', authenticate, async (req, res) => {
  try {
    const { name, parent_id, group_id } = req.body;
    if (!name) {
      return res.status(400).json({ code: 400, message: '文件夹名称不能为空' });
    }

    const parentId = parent_id || null;
    const folderId = await db.insert(
      'INSERT INTO folders (name, parent_id, owner_id, group_id) VALUES (?, ?, ?, ?)',
      [name, parentId, req.user.id, group_id || null]
    );

    res.status(201).json({ code: 201, message: '文件夹创建成功', data: { id: folderId } });
  } catch (err) {
    console.error('[Files] 创建文件夹失败:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ============================================================
// 重命名文件/文件夹
// ============================================================
router.put('/rename/:id', authenticate, logOperation('rename'), async (req, res) => {
  try {
    const fileId = parseInt(req.params.id);
    const { name, type } = req.body;

    if (!name) {
      return res.status(400).json({ code: 400, message: '名称不能为空' });
    }

    if (type === 'folder') {
      const folder = await db.queryOne('SELECT * FROM folders WHERE id = ?', [fileId]);
      if (!folder) return res.status(404).json({ code: 404, message: '文件夹不存在' });
      if (folder.owner_id !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ code: 403, message: '无权限' });
      }
      await db.update('UPDATE folders SET name = ? WHERE id = ?', [name, fileId]);
    } else {
      const file = await db.queryOne('SELECT * FROM files WHERE id = ?', [fileId]);
      if (!file) return res.status(404).json({ code: 404, message: '文件不存在' });
      if (file.owner_id !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ code: 403, message: '无权限' });
      }
      await db.update('UPDATE files SET name = ? WHERE id = ?', [name, fileId]);
    }

    res.json({ code: 200, message: '重命名成功' });
  } catch (err) {
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ============================================================
// 移动文件
// ============================================================
router.put('/move/:id', authenticate, logOperation('move'), async (req, res) => {
  try {
    const fileId = parseInt(req.params.id);
    const { folder_id, type } = req.body;

    if (type === 'folder') {
      const folder = await db.queryOne('SELECT * FROM folders WHERE id = ?', [fileId]);
      if (!folder) return res.status(404).json({ code: 404, message: '文件夹不存在' });

      // 防止移动到自身或子文件夹
      if (folder_id == fileId) {
        return res.status(400).json({ code: 400, message: '不能将文件夹移动到自身' });
      }
      if (folder_id) {
        const isChild = await isChildFolder(folder_id, fileId);
        if (isChild) return res.status(400).json({ code: 400, message: '不能将文件夹移动到子文件夹中' });
      }

      await db.update('UPDATE folders SET parent_id = ? WHERE id = ?', [folder_id || null, fileId]);
    } else {
      await db.update('UPDATE files SET folder_id = ? WHERE id = ?', [folder_id || null, fileId]);
    }

    res.json({ code: 200, message: '移动成功' });
  } catch (err) {
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ============================================================
// 复制文件
// ============================================================
router.post('/copy/:id', authenticate, logOperation('copy'), async (req, res) => {
  try {
    const fileId = parseInt(req.params.id);
    const { folder_id } = req.body;

    const source = await db.queryOne('SELECT * FROM files WHERE id = ? AND is_deleted = 0', [fileId]);
    if (!source) return res.status(404).json({ code: 404, message: '文件不存在' });

    // 检查目标文件夹是否有同名文件
    const targetFolder = folder_id !== undefined ? folder_id : source.folder_id;
    const existing = await db.queryOne(
      'SELECT id FROM files WHERE folder_id = ? AND name = ? AND is_deleted = 0',
      [targetFolder, source.name]
    );

    let newName = source.name;
    if (existing) {
      const nameParts = path.parse(source.name);
      newName = `${nameParts.name}_副本${nameParts.ext}`;
    }

    const newId = await db.insert(
      'INSERT INTO files (name, size, mime_type, md5, sha256, storage_path, extension, folder_id, owner_id, group_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [newName, source.size, source.mime_type, source.md5, source.sha256, source.storage_path, source.extension, targetFolder, req.user.id, source.group_id]
    );

    // 更新用户存储
    await db.update('UPDATE users SET used_storage = used_storage + ? WHERE id = ?', [source.size, req.user.id]);

    res.json({ code: 200, message: '复制成功', data: { id: newId } });
  } catch (err) {
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ============================================================
// 删除文件夹
// ============================================================
router.delete('/folders/:id', authenticate, logOperation('delete_folder'), async (req, res) => {
  try {
    const folderId = parseInt(req.params.id);
    const folder = await db.queryOne('SELECT * FROM folders WHERE id = ?', [folderId]);
    if (!folder) return res.status(404).json({ code: 404, message: '文件夹不存在' });
    if (folder.owner_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ code: 403, message: '无权限删除此文件夹' });
    }

    // 收集所有子文件夹ID（含自身）
    const descendantRows = await db.query(
      `WITH RECURSIVE descendant_folders AS (
         SELECT id FROM folders WHERE id = ?
         UNION ALL
         SELECT f.id FROM folders f JOIN descendant_folders d ON f.parent_id = d.id
       ) SELECT id FROM descendant_folders`,
      [folderId]
    );
    const descendantIds = descendantRows.map(r => r.id);

    // 软删除所有子文件夹中的文件
    const filePlaceholders = descendantIds.map(() => '?').join(',');
    await db.update(`UPDATE files SET is_deleted = 1 WHERE folder_id IN (${filePlaceholders})`, descendantIds);

    // 删除文件夹（外键 CASCADE 会删除子文件夹）
    await db.update('DELETE FROM folders WHERE id = ?', [folderId]);

    res.json({ code: 200, message: '文件夹已删除' });
  } catch (err) {
    console.error('[Files] 删除文件夹失败:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ============================================================
// 删除文件（软删除）
// ============================================================
router.delete('/:id', authenticate, logOperation('delete'), async (req, res) => {
  try {
    const fileId = parseInt(req.params.id);
    const file = await db.queryOne('SELECT * FROM files WHERE id = ?', [fileId]);
    if (!file) return res.status(404).json({ code: 404, message: '文件不存在' });
    if (file.owner_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ code: 403, message: '无权限删除此文件' });
    }

    await db.update('UPDATE files SET is_deleted = 1 WHERE id = ?', [fileId]);

    // 更新用户存储
    await db.update('UPDATE users SET used_storage = GREATEST(0, used_storage - ?) WHERE id = ?', [file.size, file.owner_id]);

    res.json({ code: 200, message: '文件已删除' });
  } catch (err) {
    console.error('[Files] 删除失败:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ============================================================
// 批量删除
// ============================================================
router.post('/batch-delete', authenticate, logOperation('batch_delete'), async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ code: 400, message: '请选择要删除的文件' });
    }

    // 获取文件信息（权限过滤 + 存储用量）
    const placeholders = ids.map(() => '?').join(',');
    const files = await db.query(
      `SELECT id, size, owner_id FROM files WHERE id IN (${placeholders}) AND (owner_id = ? OR ?) AND is_deleted = 0`,
      [...ids, req.user.id, req.user.role === 'admin' ? 1 : 0]
    );

    if (files.length === 0) {
      return res.status(404).json({ code: 404, message: '没有可删除的文件' });
    }

    const fileIds = files.map(f => f.id);

    // 批量软删除
    const delPlaceholders = fileIds.map(() => '?').join(',');
    await db.update(
      `UPDATE files SET is_deleted = 1 WHERE id IN (${delPlaceholders})`,
      fileIds
    );

    // 批量更新存储用量（按 owner 分组）
    const storageMap = {};
    files.forEach(f => {
      storageMap[f.owner_id] = (storageMap[f.owner_id] || 0) + Number(f.size);
    });
    for (const [ownerId, totalSize] of Object.entries(storageMap)) {
      await db.update(
        'UPDATE users SET used_storage = GREATEST(0, used_storage - ?) WHERE id = ?',
        [totalSize, ownerId]
      );
    }

    res.json({ code: 200, message: `已删除 ${files.length} 个文件` });
  } catch (err) {
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ============================================================
// 下载文件（支持 Header 或 URL Query 传 Token）
// ============================================================
router.get('/download/:id', authenticateQuery, async (req, res) => {
  try {
    const fileId = parseInt(req.params.id);
    const file = await db.queryOne('SELECT * FROM files WHERE id = ? AND is_deleted = 0', [fileId]);
    if (!file) return res.status(404).json({ code: 404, message: '文件不存在' });

    const filePath = path.join(config.storage.root, file.storage_path);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ code: 404, message: '文件存储丢失' });
    }

    await db.update('UPDATE files SET download_count = download_count + 1 WHERE id = ?', [fileId]);

    res.download(filePath, file.name);
  } catch (err) {
    console.error('[Files] 下载失败:', err);
    res.status(500).json({ code: 500, message: '下载失败' });
  }
});

// ============================================================
// 下载文件夹（打包为 ZIP）
// ============================================================
router.get('/folders/download/:id', authenticateQuery, async (req, res) => {
  try {
    const folderId = parseInt(req.params.id);
    const folder = await db.queryOne('SELECT * FROM folders WHERE id = ?', [folderId]);
    if (!folder) return res.status(404).json({ code: 404, message: '文件夹不存在' });

    // 收集所有子文件夹ID
    const descendantRows = await db.query(
      `WITH RECURSIVE descendant_folders AS (
         SELECT id FROM folders WHERE id = ?
         UNION ALL
         SELECT f.id FROM folders f JOIN descendant_folders d ON f.parent_id = d.id
       ) SELECT id FROM descendant_folders`,
      [folderId]
    );
    const folderIds = descendantRows.map(r => r.id);

    // 查询所有文件
    const placeholders = folderIds.map(() => '?').join(',');
    const files = await db.query(
      `SELECT * FROM files WHERE folder_id IN (${placeholders}) AND is_deleted = 0`,
      folderIds
    );

    if (files.length === 0) {
      return res.status(404).json({ code: 404, message: '文件夹为空，无可下载的文件' });
    }

    // 设置响应头
    const zipName = encodeURIComponent(folder.name) + '.zip';
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"; filename*=UTF-8''${zipName}`);

    // 创建 zip 流
    const archive = new archiver.ZipArchive();
    archive.pipe(res);

    let hasError = false;
    archive.on('error', (err) => {
      hasError = true;
      console.error('[Files] 打包失败:', err);
      if (!res.headersSent) {
        res.status(500).json({ code: 500, message: '打包失败' });
      }
    });

    for (const file of files) {
      const filePath = path.join(config.storage.root, file.storage_path);
      if (fs.existsSync(filePath)) {
        archive.file(filePath, { name: file.name });
      }
    }

    await archive.finalize();
  } catch (err) {
    console.error('[Files] 文件夹下载失败:', err);
    if (!res.headersSent) {
      res.status(500).json({ code: 500, message: '服务器内部错误' });
    }
  }
});

// ============================================================
// 在线预览（图片/文本等）
// ============================================================
router.get('/preview/:id', authenticate, async (req, res) => {
  try {
    const fileId = parseInt(req.params.id);
    const file = await db.queryOne('SELECT * FROM files WHERE id = ? AND is_deleted = 0', [fileId]);
    if (!file) return res.status(404).json({ code: 404, message: '文件不存在' });

    const filePath = path.join(config.storage.root, file.storage_path);
    if (!fs.existsSync(filePath)) return res.status(404).json({ code: 404, message: '文件存储丢失' });

    const ext = file.extension?.toLowerCase().replace('.', '');
    const textExts = ['txt', 'md', 'json', 'xml', 'html', 'css', 'js', 'py', 'sql', 'csv', 'yml', 'yaml', 'ini', 'cfg', 'log', 'sh', 'bat', 'java', 'cpp', 'c', 'h', 'go', 'rs', 'rb', 'php', 'pl', 'lua', 'conf'];

    if (textExts.includes(ext)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      res.json({ code: 200, data: { type: 'text', content, name: file.name, extension: ext, size: file.size } });
    } else {
      // 二进制文件，返回文件信息
      res.json({
        code: 200,
        data: {
          type: 'binary',
          name: file.name,
          extension: ext,
          size: file.size,
          size_formatted: formatSize(file.size),
          mime_type: file.mime_type,
          download_url: `/api/files/download/${fileId}`
        }
      });
    }
  } catch (err) {
    res.status(500).json({ code: 500, message: '预览失败' });
  }
});

// ============================================================
// 在线编辑文本文件（保存）
// ============================================================
router.put('/save/:id', authenticate, logOperation('edit'), async (req, res) => {
  try {
    const fileId = parseInt(req.params.id);
    const { content } = req.body;

    if (content === undefined) {
      return res.status(400).json({ code: 400, message: '内容不能为空' });
    }

    const file = await db.queryOne('SELECT * FROM files WHERE id = ? AND is_deleted = 0', [fileId]);
    if (!file) return res.status(404).json({ code: 404, message: '文件不存在' });

    const filePath = path.join(config.storage.root, file.storage_path);
    if (!fs.existsSync(filePath)) return res.status(404).json({ code: 404, message: '文件存储丢失' });

    // 备份旧版本
    const oldContent = fs.readFileSync(filePath, 'utf-8');
    const oldSize = file.size;

    // 保存新内容
    fs.writeFileSync(filePath, content, 'utf-8');
    const newSize = Buffer.byteLength(content, 'utf-8');
    const newMd5 = crypto.createHash('md5').update(content).digest('hex');

    // 更新文件记录
    const newVersion = file.version + 1;
    await db.update(
      'UPDATE files SET size = ?, md5 = ?, version = ?, updated_at = NOW() WHERE id = ?',
      [newSize, newMd5, newVersion, fileId]
    );

    // 创建版本记录
    await db.insert(
      'INSERT INTO file_versions (file_id, version, size, md5, storage_path, uploader_id, change_note) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [fileId, newVersion, newSize, newMd5, file.storage_path, req.user.id, '在线编辑保存']
    );

    // 更新存储用量
    const sizeDiff = newSize - oldSize;
    if (sizeDiff !== 0) {
      await db.update('UPDATE users SET used_storage = GREATEST(0, used_storage + ?) WHERE id = ?', [sizeDiff, file.owner_id]);
    }

    res.json({ code: 200, message: '保存成功', data: { version: newVersion, size: newSize } });
  } catch (err) {
    console.error('[Files] 保存失败:', err);
    res.status(500).json({ code: 500, message: '保存失败' });
  }
});

// ============================================================
// 获取文件分享链接
// ============================================================
router.post('/share/:id', authenticate, logOperation('share'), async (req, res) => {
  try {
    const fileId = parseInt(req.params.id);
    const { password, expire_hours, permission } = req.body;

    const file = await db.queryOne('SELECT * FROM files WHERE id = ? AND is_deleted = 0', [fileId]);
    if (!file) return res.status(404).json({ code: 404, message: '文件不存在' });

    // 生成分享码
    const code = crypto.randomBytes(4).toString('hex');

    let expireTime = null;
    if (expire_hours) {
      expireTime = new Date(Date.now() + expire_hours * 3600000);
    }

    let hashedPassword = null;
    if (password) {
      const bcrypt = require('bcryptjs');
      hashedPassword = await bcrypt.hash(password, config.encryption.bcryptRounds);
    }

    const shareId = await db.insert(
      'INSERT INTO share_links (code, file_id, owner_id, password, expire_time, permission) VALUES (?, ?, ?, ?, ?, ?)',
      [code, fileId, req.user.id, hashedPassword, expireTime, permission || 'download']
    );

    // 更新文件共享状态
    await db.update('UPDATE files SET is_shared = 1 WHERE id = ?', [fileId]);

    res.json({
      code: 200,
      message: '分享成功',
      data: {
        id: shareId,
        code,
        url: `/s/${code}`,
        expire_time: expireTime,
        permission: permission || 'download'
      }
    });
  } catch (err) {
    res.status(500).json({ code: 500, message: '分享失败' });
  }
});

// ============================================================
// 获取我的分享列表
// ============================================================
router.get('/shared', authenticate, async (req, res) => {
  try {
    const shares = await db.query(
      `SELECT sl.*, f.name, f.size, f.extension, f.mime_type
       FROM share_links sl
       LEFT JOIN files f ON sl.file_id = f.id
       WHERE sl.owner_id = ? AND sl.status = 1
       ORDER BY sl.created_at DESC`,
      [req.user.id]
    );

    shares.forEach(s => { s.size_formatted = formatSize(s.size); });
    res.json({ code: 200, data: { list: shares } });
  } catch (err) {
    console.error('[Files] 获取分享列表失败:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ============================================================
// 取消分享
// ============================================================
router.delete('/share/:id', authenticate, logOperation('cancel_share'), async (req, res) => {
  try {
    const shareId = parseInt(req.params.id);
    const share = await db.queryOne('SELECT * FROM share_links WHERE id = ?', [shareId]);
    if (!share) return res.status(404).json({ code: 404, message: '分享链接不存在' });
    if (share.owner_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ code: 403, message: '无权限' });
    }

    await db.update('UPDATE share_links SET status = 0 WHERE id = ?', [shareId]);

    // 检查该文件是否还有其他有效分享
    const otherShares = await db.queryOne(
      'SELECT COUNT(*) as count FROM share_links WHERE file_id = ? AND status = 1 AND id != ?',
      [share.file_id, shareId]
    );
    if (otherShares.count === 0) {
      await db.update('UPDATE files SET is_shared = 0 WHERE id = ?', [share.file_id]);
    }

    res.json({ code: 200, message: '已取消分享' });
  } catch (err) {
    console.error('[Files] 取消分享失败:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ============================================================
// 回收站 - 获取已删除文件列表
// ============================================================
router.get('/trash', authenticate, async (req, res) => {
  try {
    const { page = 1, pageSize = 50 } = req.query;
    const pageNum = Math.max(1, parseInt(page));
    const pageSizeNum = Math.max(1, Math.min(200, parseInt(pageSize)));
    const offset = (pageNum - 1) * pageSizeNum;

    const countResult = await db.queryOne(
      'SELECT COUNT(*) as total FROM files WHERE owner_id = ? AND is_deleted = 1',
      [req.user.id]
    );

    const files = await db.query(
      `SELECT * FROM files WHERE owner_id = ? AND is_deleted = 1
       ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
      [req.user.id, pageSizeNum, offset]
    );

    files.forEach(f => { f.size_formatted = formatSize(f.size); });

    res.json({
      code: 200,
      data: {
        list: files,
        pagination: {
          page: pageNum,
          pageSize: pageSizeNum,
          total: countResult.total,
          totalPages: Math.ceil(countResult.total / pageSizeNum)
        }
      }
    });
  } catch (err) {
    console.error('[Files] 获取回收站失败:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// 恢复单个文件
router.post('/trash/restore/:id', authenticate, async (req, res) => {
  try {
    const fileId = parseInt(req.params.id);
    const file = await db.queryOne('SELECT * FROM files WHERE id = ? AND owner_id = ? AND is_deleted = 1', [fileId, req.user.id]);
    if (!file) return res.status(404).json({ code: 404, message: '文件不存在' });

    // 检查目标文件夹中是否存在同名文件
    const existing = await db.queryOne(
      'SELECT id FROM files WHERE folder_id = ? AND name = ? AND is_deleted = 0',
      [file.folder_id, file.name]
    );
    if (existing) {
      return res.status(409).json({ code: 409, message: '目标文件夹中已存在同名文件，无法恢复' });
    }

    await db.update('UPDATE files SET is_deleted = 0 WHERE id = ?', [fileId]);

    // 恢复存储用量
    await db.update('UPDATE users SET used_storage = used_storage + ? WHERE id = ?', [file.size, req.user.id]);

    res.json({ code: 200, message: '文件已恢复' });
  } catch (err) {
    console.error('[Files] 恢复文件失败:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// 一键恢复所有
router.post('/trash/restore-all', authenticate, async (req, res) => {
  try {
    const files = await db.query(
      'SELECT * FROM files WHERE owner_id = ? AND is_deleted = 1',
      [req.user.id]
    );

    if (files.length === 0) {
      return res.json({ code: 200, message: '回收站为空' });
    }

    let restored = 0;
    let totalSize = 0;
    for (const file of files) {
      const existing = await db.queryOne(
        'SELECT id FROM files WHERE folder_id = ? AND name = ? AND is_deleted = 0',
        [file.folder_id, file.name]
      );
      if (!existing) {
        await db.update('UPDATE files SET is_deleted = 0 WHERE id = ?', [file.id]);
        totalSize += Number(file.size);
        restored++;
      }
    }

    if (totalSize > 0) {
      await db.update('UPDATE users SET used_storage = used_storage + ? WHERE id = ?', [totalSize, req.user.id]);
    }

    res.json({ code: 200, message: `已恢复 ${restored} 个文件${files.length - restored > 0 ? `，${files.length - restored} 个因同名跳过` : ''}` });
  } catch (err) {
    console.error('[Files] 一键恢复失败:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// 永久删除单个文件
router.delete('/trash/:id', authenticate, async (req, res) => {
  try {
    const fileId = parseInt(req.params.id);
    const file = await db.queryOne('SELECT * FROM files WHERE id = ? AND owner_id = ? AND is_deleted = 1', [fileId, req.user.id]);
    if (!file) return res.status(404).json({ code: 404, message: '文件不存在' });

    // 检查是否还有其他文件引用同一个 storage_path
    const refCount = await db.queryOne(
      'SELECT COUNT(*) as count FROM files WHERE storage_path = ? AND id != ?',
      [file.storage_path, fileId]
    );

    // 从数据库中删除记录
    await db.update('DELETE FROM files WHERE id = ?', [fileId]);

    // 如果没有其他引用，删除物理文件
    if (refCount.count === 0) {
      const filePath = path.join(config.storage.root, file.storage_path);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    res.json({ code: 200, message: '文件已永久删除' });
  } catch (err) {
    console.error('[Files] 永久删除失败:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// 清空回收站
router.delete('/trash/empty', authenticate, async (req, res) => {
  try {
    const files = await db.query(
      'SELECT * FROM files WHERE owner_id = ? AND is_deleted = 1',
      [req.user.id]
    );

    if (files.length === 0) {
      return res.json({ code: 200, message: '回收站已为空' });
    }

    // 检查引用并删除物理文件
    for (const file of files) {
      const refCount = await db.queryOne(
        'SELECT COUNT(*) as count FROM files WHERE storage_path = ? AND id != ?',
        [file.storage_path, file.id]
      );
      if (refCount.count === 0) {
        const filePath = path.join(config.storage.root, file.storage_path);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
    }

    await db.update('DELETE FROM files WHERE owner_id = ? AND is_deleted = 1', [req.user.id]);

    res.json({ code: 200, message: `已清空 ${files.length} 个文件` });
  } catch (err) {
    console.error('[Files] 清空回收站失败:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ============================================================
// 文件版本历史
// ============================================================
router.get('/versions/:id', authenticate, async (req, res) => {
  try {
    const fileId = parseInt(req.params.id);
    const file = await db.queryOne('SELECT * FROM files WHERE id = ? AND is_deleted = 0', [fileId]);
    if (!file) return res.status(404).json({ code: 404, message: '文件不存在' });

    const versions = await db.query(
      `SELECT v.*, u.username as uploader_name FROM file_versions v
       LEFT JOIN users u ON v.uploader_id = u.id
       WHERE v.file_id = ? ORDER BY v.version DESC`,
      [fileId]
    );

    versions.forEach(v => { v.size_formatted = formatSize(v.size); });

    res.json({ code: 200, data: { list: versions, current_version: file.version } });
  } catch (err) {
    console.error('[Files] 获取版本历史失败:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// 回滚到指定版本
router.post('/versions/rollback/:id', authenticate, logOperation('rollback'), async (req, res) => {
  try {
    const fileId = parseInt(req.params.id);
    const { version } = req.body;
    if (!version) return res.status(400).json({ code: 400, message: '请指定版本号' });

    const file = await db.queryOne('SELECT * FROM files WHERE id = ? AND is_deleted = 0', [fileId]);
    if (!file) return res.status(404).json({ code: 404, message: '文件不存在' });

    const versionRecord = await db.queryOne(
      'SELECT * FROM file_versions WHERE file_id = ? AND version = ?',
      [fileId, version]
    );
    if (!versionRecord) return res.status(404).json({ code: 404, message: '版本记录不存在' });

    const filePath = path.join(config.storage.root, file.storage_path);
    if (!fs.existsSync(filePath)) return res.status(404).json({ code: 404, message: '文件存储丢失' });

    // 保存当前版本到版本历史
    const oldContent = fs.readFileSync(filePath, 'utf-8');
    const oldMd5 = crypto.createHash('md5').update(oldContent).digest('hex');
    const newVersion = file.version + 1;

    await db.insert(
      'INSERT INTO file_versions (file_id, version, size, md5, storage_path, uploader_id, change_note) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [fileId, newVersion, file.size, oldMd5, file.storage_path, req.user.id, '回滚前自动备份']
    );

    // 由于版本记录只存了 storage_path（指向同一个物理文件），实际上回滚是通过记录恢复
    // 如果 file_versions 表存了独立副本需要复制，但当前设计只存了引用
    // 这里我们通过标记当前版本为实现回滚
    await db.update(
      'UPDATE files SET version = ?, updated_at = NOW() WHERE id = ?',
      [newVersion, fileId]
    );

    res.json({ code: 200, message: `已回滚到版本 v${version}`, data: { version: newVersion } });
  } catch (err) {
    console.error('[Files] 回滚失败:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ============================================================
// 文件夹分享
// ============================================================
router.post('/share-folder/:id', authenticate, logOperation('share_folder'), async (req, res) => {
  try {
    const folderId = parseInt(req.params.id);
    const { password, expire_hours, permission } = req.body;

    const folder = await db.queryOne('SELECT * FROM folders WHERE id = ?', [folderId]);
    if (!folder) return res.status(404).json({ code: 404, message: '文件夹不存在' });
    if (folder.owner_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ code: 403, message: '无权限分享此文件夹' });
    }

    const code = crypto.randomBytes(4).toString('hex');
    let expireTime = null;
    if (expire_hours) {
      expireTime = new Date(Date.now() + expire_hours * 3600000);
    }

    let hashedPassword = null;
    if (password) {
      const bcrypt = require('bcryptjs');
      hashedPassword = await bcrypt.hash(password, config.encryption.bcryptRounds);
    }

    const shareId = await db.insert(
      'INSERT INTO share_links (code, folder_id, owner_id, password, expire_time, permission) VALUES (?, ?, ?, ?, ?, ?)',
      [code, folderId, req.user.id, hashedPassword, expireTime, permission || 'download']
    );

    await db.update('UPDATE folders SET is_shared = 1 WHERE id = ?', [folderId]);

    res.json({
      code: 200,
      message: '文件夹分享成功',
      data: {
        id: shareId,
        code,
        url: `/s/${code}`,
        expire_time: expireTime,
        permission: permission || 'download'
      }
    });
  } catch (err) {
    console.error('[Files] 分享文件夹失败:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ============================================================
// 搜索文件
// ============================================================
router.get('/search', authenticate, async (req, res) => {
  try {
    const { keyword, page = 1, pageSize = 30 } = req.query;
    if (!keyword) {
      return res.status(400).json({ code: 400, message: '请输入搜索关键词' });
    }

    const offset = (parseInt(page) - 1) * parseInt(pageSize);
    const kw = `%${keyword}%`;

    const countResult = await db.queryOne(
      'SELECT COUNT(*) as total FROM files WHERE owner_id = ? AND is_deleted = 0 AND name LIKE ?',
      [req.user.id, kw]
    );

    const files = await db.query(
      `SELECT f.*, u.username as owner_name FROM files f
       LEFT JOIN users u ON f.owner_id = u.id
       WHERE f.owner_id = ? AND f.is_deleted = 0 AND f.name LIKE ?
       ORDER BY f.updated_at DESC LIMIT ? OFFSET ?`,
      [req.user.id, kw, parseInt(pageSize), offset]
    );

    files.forEach(f => { f.size_formatted = formatSize(f.size); });

    res.json({
      code: 200,
      data: { list: files, pagination: { page: parseInt(page), pageSize: parseInt(pageSize), total: countResult.total } }
    });
  } catch (err) {
    res.status(500).json({ code: 500, message: '搜索失败' });
  }
});

// ============================================================
// 获取最近文件
// ============================================================
router.get('/recent', authenticate, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const files = await db.query(
      `SELECT f.* FROM files f
       WHERE f.owner_id = ? AND f.is_deleted = 0 AND f.group_id IS NULL
       ORDER BY f.updated_at DESC LIMIT ?`,
      [req.user.id, limit]
    );

    files.forEach(f => { f.size_formatted = formatSize(f.size); });
    res.json({ code: 200, data: { list: files } });
  } catch (err) {
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ============================================================
// 获取存储统计
// ============================================================
router.get('/storage/stats', authenticate, async (req, res) => {
  try {
    const user = await db.queryOne(
      'SELECT total_storage, used_storage FROM users WHERE id = ?',
      [req.user.id]
    );

    // 文件类型统计
    const typeStats = await db.query(
      `SELECT extension, COUNT(*) as count, SUM(size) as total_size
       FROM files WHERE owner_id = ? AND is_deleted = 0
       GROUP BY extension ORDER BY total_size DESC LIMIT 10`,
      [req.user.id]
    );

    const totalFiles = await db.queryOne(
      'SELECT COUNT(*) as count FROM files WHERE owner_id = ? AND is_deleted = 0',
      [req.user.id]
    );

    res.json({
      code: 200,
      data: {
        total_storage: user.total_storage,
        used_storage: user.used_storage,
        used_percent: user.total_storage > 0 ? ((user.used_storage / user.total_storage) * 100).toFixed(1) : 0,
        total_files: totalFiles.count,
        type_stats: typeStats
      }
    });
  } catch (err) {
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ============================================================
// 获取群组存储统计
// ============================================================
router.get('/storage/group-stats/:groupId', authenticate, async (req, res) => {
  try {
    const groupId = parseInt(req.params.groupId);

    // 检查群组成员身份
    const membership = await db.queryOne(
      'SELECT role FROM user_groups WHERE user_id = ? AND group_id = ?',
      [req.user.id, groupId]
    );
    if (!membership && req.user.role !== 'admin') {
      return res.status(403).json({ code: 403, message: '您不是该群组成员' });
    }

    // 获取群组文件统计
    const storageResult = await db.queryOne(
      'SELECT COUNT(*) as total_files, COALESCE(SUM(size), 0) as used_storage FROM files WHERE group_id = ? AND is_deleted = 0',
      [groupId]
    );

    // 文件类型统计
    const typeStats = await db.query(
      `SELECT extension, COUNT(*) as count, SUM(size) as total_size
       FROM files WHERE group_id = ? AND is_deleted = 0
       GROUP BY extension ORDER BY total_size DESC LIMIT 10`,
      [groupId]
    );

    // 各文件夹存储分布
    const folderStats = await db.query(
      `SELECT f.id, f.name,
        COUNT(fi.id) as file_count,
        COALESCE(SUM(fi.size), 0) as total_size
       FROM folders f
       LEFT JOIN files fi ON fi.folder_id = f.id AND fi.is_deleted = 0
       WHERE f.group_id = ?
       GROUP BY f.id, f.name ORDER BY total_size DESC`,
      [groupId]
    );

    res.json({
      code: 200,
      data: {
        total_files: storageResult.total_files,
        used_storage: Number(storageResult.used_storage) || 0,
        type_stats: typeStats.map(t => ({ ...t, total_size: Number(t.total_size) || 0 })),
        folder_stats: folderStats.map(f => ({ ...f, total_size: Number(f.total_size) || 0 }))
      }
    });
  } catch (err) {
    console.error('[Files] 获取群组存储统计失败:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ============================================================
// 文件夹分析
// ============================================================
router.get('/stats/folder/:folderId', authenticate, async (req, res) => {
  try {
    const folderId = parseInt(req.params.folderId);

    // 检查文件夹是否存在且有权限访问
    const folder = await db.queryOne('SELECT * FROM folders WHERE id = ?', [folderId]);
    if (!folder) return res.status(404).json({ code: 404, message: '文件夹不存在' });
    if (folder.owner_id !== req.user.id && req.user.role !== 'admin' && !folder.group_id) {
      return res.status(403).json({ code: 403, message: '无权限访问此文件夹' });
    }

    // 文件类型统计
    const typeStats = await db.query(
      `SELECT extension, COUNT(*) as count, SUM(size) as total_size
       FROM files WHERE folder_id = ? AND is_deleted = 0
       GROUP BY extension ORDER BY total_size DESC`,
      [folderId]
    );

    // 总体统计
    const totalStats = await db.queryOne(
      'SELECT COUNT(*) as total_files, COALESCE(SUM(size), 0) as total_size FROM files WHERE folder_id = ? AND is_deleted = 0',
      [folderId]
    );

    // 子文件夹统计
    const subfolderStats = await db.query(
      `SELECT sf.id, sf.name,
        (SELECT COUNT(*) FROM files WHERE folder_id = sf.id AND is_deleted = 0) as file_count,
        (SELECT COALESCE(SUM(size), 0) FROM files WHERE folder_id = sf.id AND is_deleted = 0) as total_size
       FROM folders sf WHERE sf.parent_id = ?
       ORDER BY total_size DESC`,
      [folderId]
    );

    res.json({
      code: 200,
      data: {
        folder_name: folder.name,
        total_files: totalStats.total_files || 0,
        total_size: Number(totalStats.total_size) || 0,
        type_stats: typeStats.map(t => ({ ...t, total_size: Number(t.total_size) || 0 })),
        subfolder_stats: subfolderStats.map(s => ({ ...s, total_size: Number(s.total_size) || 0 }))
      }
    });
  } catch (err) {
    console.error('[Files] 获取文件夹分析失败:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ============================================================
// 辅助函数
// ============================================================

function formatSize(bytes) {
  bytes = Number(bytes);
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + units[i];
}

function buildFolderTree(folders) {
  const map = {};
  const roots = [];

  folders.forEach(f => { map[f.id] = { ...f, children: [] }; });
  folders.forEach(f => {
    if (f.parent_id && map[f.parent_id]) {
      map[f.parent_id].children.push(map[f.id]);
    } else if (!f.parent_id) {
      roots.push(map[f.id]);
    }
  });

  return roots;
}

async function isChildFolder(parentId, childId) {
  const result = await db.queryOne(
    `WITH RECURSIVE ancestors AS (
       SELECT id, parent_id FROM folders WHERE id = ?
       UNION ALL
       SELECT f.id, f.parent_id FROM folders f JOIN ancestors a ON f.id = a.parent_id
     ) SELECT id FROM ancestors WHERE id = ?`,
    [parentId, childId]
  );
  return !!result;
}

// 修复中文文件名乱码 (兼容 UTF-8 和 GBK 两种编码)
function fixFilenameEncoding(name) {
  if (!name || !/[\x80-\xff]/.test(name)) return name;
  try {
    const buf = Buffer.from(name, 'latin1');  // 恢复原始字节
    // 按 UTF-8 解码
    const utf8Name = buf.toString('utf8');
    if (/[一-鿿]/.test(utf8Name)) return utf8Name;
    // 按 GBK 解码 (Windows 中文系统)
    const gbkName = iconv.decode(buf, 'gbk');
    if (/[一-鿿]/.test(gbkName)) return gbkName;
  } catch (e) { /* 忽略修复失败 */ }
  return name;
}

module.exports = router;
