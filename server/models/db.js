// ============================================================
// 数据库连接池
// ============================================================
const mysql = require('mysql2/promise');
const config = require('../config');

const pool = mysql.createPool(config.db);

// 测试连接
pool.getConnection()
  .then(conn => {
    console.log('[DB] 数据库连接成功');
    conn.release();
  })
  .catch(err => {
    console.error('[DB] 数据库连接失败:', err.message);
  });

// 执行查询的便捷方法
async function query(sql, params) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

// 执行查询并返回第一行
async function queryOne(sql, params) {
  const rows = await query(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

// 执行插入并返回插入ID
async function insert(sql, params) {
  const [result] = await pool.query(sql, params);
  return result.insertId;
}

// 执行更新并返回影响行数
async function update(sql, params) {
  const [result] = await pool.query(sql, params);
  return result.affectedRows;
}

// 开启事务
async function beginTransaction() {
  const conn = await pool.getConnection();
  await conn.beginTransaction();
  return conn;
}

// 在事务中执行查询
async function queryWithConn(conn, sql, params) {
  const [rows] = await conn.execute(sql, params);
  return rows;
}

// 在事务中执行插入
async function insertWithConn(conn, sql, params) {
  const [result] = await conn.execute(sql, params);
  return result.insertId;
}

module.exports = {
  pool,
  query,
  queryOne,
  insert,
  update,
  beginTransaction,
  queryWithConn,
  insertWithConn
};
