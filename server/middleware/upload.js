// ============================================================
// 文件上传中间件 - 写入磁盘同时计算MD5，避免二次读取
// ============================================================
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');

// 确保存储目录存在
const storageRoot = config.storage.root;
if (!fs.existsSync(storageRoot)) {
  fs.mkdirSync(storageRoot, { recursive: true });
}

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

const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, getDateDir()),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  }
});

// 包装 _handleFile：写入磁盘同时计算 MD5，结果挂载到 req.fileMd5
const originalHandleFile = diskStorage._handleFile.bind(diskStorage);
diskStorage._handleFile = function (req, file, cb) {
  const hash = crypto.createHash('md5');
  file.stream.on('data', chunk => hash.update(chunk));
  originalHandleFile(req, file, (err, info) => {
    if (err) return cb(err);
    req.fileMd5 = hash.digest('hex');
    cb(null, info);
  });
};

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
  storage: diskStorage,
  fileFilter,
  limits: { fileSize: config.storage.maxFileSize }
});

module.exports = upload;
