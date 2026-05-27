// ============================================================
// 认证辅助模块
// ============================================================
const Auth = {
  // 检查登录状态
  check() {
    const token = localStorage.getItem('token');
    const user = this.getUser();
    if (!token || !user) {
      window.location.href = '/login.html';
      return false;
    }
    return true;
  },

  // 检查管理员权限
  requireAdmin() {
    if (!this.check()) return false;
    const user = this.getUser();
    if (user.role !== 'admin') {
      alert('需要管理员权限');
      window.location.href = '/dashboard.html';
      return false;
    }
    return true;
  },

  // 保存登录信息
  setLogin(data) {
    localStorage.setItem('token', data.token);
    if (data.refreshToken) {
      localStorage.setItem('refreshToken', data.refreshToken);
    }
    localStorage.setItem('user', JSON.stringify(data.user));
  },

  // 获取当前用户
  getUser() {
    try {
      const user = localStorage.getItem('user');
      return user ? JSON.parse(user) : null;
    } catch { return null; }
  },

  // 退出登录
  logout() {
    localStorage.clear();
    window.location.href = '/login.html';
  },

  // 更新用户信息
  updateUser(data) {
    const user = this.getUser();
    if (user) {
      localStorage.setItem('user', JSON.stringify({ ...user, ...data }));
    }
  }
};

// 页面加载时更新用户信息
async function loadUserInfo() {
  if (!localStorage.getItem('token')) return;
  const result = await API.getProfile();
  if (result.code === 200 && result.data) {
    Auth.updateUser(result.data);
  }
}

// HTML转义
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// 格式化文件大小
function formatSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + units[i];
}

// 格式化日期
function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}天前`;
  return d.toLocaleDateString('zh-CN');
}

// 获取文件图标
function getFileIcon(ext) {
  if (!ext) return 'fa-file';
  const map = {
    'jpg': 'fa-file-image', 'jpeg': 'fa-file-image', 'png': 'fa-file-image', 'gif': 'fa-file-image', 'bmp': 'fa-file-image', 'svg': 'fa-file-image', 'webp': 'fa-file-image',
    'doc': 'fa-file-word', 'docx': 'fa-file-word',
    'xls': 'fa-file-excel', 'xlsx': 'fa-file-excel',
    'ppt': 'fa-file-powerpoint', 'pptx': 'fa-file-powerpoint',
    'pdf': 'fa-file-pdf',
    'zip': 'fa-file-archive', 'rar': 'fa-file-archive', '7z': 'fa-file-archive', 'tar': 'fa-file-archive', 'gz': 'fa-file-archive',
    'mp4': 'fa-file-video', 'avi': 'fa-file-video', 'mov': 'fa-file-video', 'mkv': 'fa-file-video',
    'mp3': 'fa-file-audio', 'wav': 'fa-file-audio', 'flac': 'fa-file-audio',
    'txt': 'fa-file-alt', 'md': 'fa-file-alt',
    'js': 'fa-file-code', 'py': 'fa-file-code', 'html': 'fa-file-code', 'css': 'fa-file-code', 'json': 'fa-file-code', 'xml': 'fa-file-code', 'java': 'fa-file-code',
  };
  return map[ext.toLowerCase()] || 'fa-file';
}
