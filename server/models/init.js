// ============================================================
// 数据库初始化脚本 - 读取 init.sql 并执行
// ============================================================
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const config = require('../config');

async function initDatabase() {
  console.log('============================================');
  console.log('  数据库初始化');
  console.log('============================================');

  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    charset: 'utf8mb4',
    multipleStatements: true
  });

  try {
    const sqlPath = path.join(__dirname, '..', '..', 'init.sql');
    let sql = fs.readFileSync(sqlPath, 'utf-8');

    // 移除 DELIMITER 语句（它们是 mysql 客户端命令，不是 SQL）
    sql = sql.replace(/^DELIMITER\s+.*$/gm, '');
    sql = sql.replace(/^DELIMITER\s*;$/gm, '');

    try {
      await conn.query(sql);
      console.log('  数据库初始化完成');
    } catch (err) {
      console.error('  SQL执行错误:', err.message);
      process.exit(1);
    }
  } finally {
    await conn.end();
  }

  process.exit(0);
}

initDatabase().catch(err => {
  console.error('  初始化失败:', err.message);
  process.exit(1);
});
