// PM2 生产环境配置
module.exports = {
  apps: [{
    name: 'cloud-drive',
    script: 'server/app.js',
    instances: process.env.NODE_ENV === 'production' ? 'max' : 1,
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      CORS_ORIGIN: '*',
    },
    env_production: {
      NODE_ENV: 'production',
      CORS_ORIGIN: '*',
    },
    // 日志配置
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs: true,
    // 自动重启
    max_memory_restart: '1G',
    // 宕机自动重启
    autorestart: true,
    // 最大重启次数
    max_restarts: 10,
    // 健康检查间隔 (ms)
    watch: false,
    // 优雅关闭超时
    kill_timeout: 30000,
    // 启动顺序
    wait_ready: true,
    listen_timeout: 5000,
  }]
};
