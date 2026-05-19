// ============================================================
// 文件上传中间件 (Multer配置)
// ============================================================
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');

// 确保存储目录存在
const storageRoot = config.storage.root;
if (!fs.existsSync(storageRoot)) {
  fs.mkdirSync(storageRoot, { recursive: true });
}

// 按日期创建子目录
function getDateDir() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const dateDir = path.join(storageRoot, `${year}${month}${day}`);
  if (!fs.existsSync(dateDir)) {
    fs.mkdirSync(dateDir, { recursive: true });
  }
  return dateDir;
}

// Multer存储配置
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, getDateDir());
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueName = `${uuidv4()}${ext}`;
    cb(null, uniqueName);
  }
});

// 文件过滤器
function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
  const allowed = config.storage.allowedExtensions.split(',');
  if (allowed.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`不允许的文件类型: .${ext}`), false);
  }
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: config.storage.maxFileSize
  }
});

module.exports = upload;
