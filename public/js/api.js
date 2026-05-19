// ============================================================
// API 客户端
// Cloud Drive API Client
// ============================================================
const API = {
  BASE: '/api',

  // 获取认证头
  _headers(extra = {}) {
    const headers = { 'Content-Type': 'application/json', ...extra };
    const token = localStorage.getItem('token');
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  },

  _formDataHeaders() {
    const headers = {};
    const token = localStorage.getItem('token');
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  },

  // 请求封装
  async _request(method, url, data = null, isFormData = false) {
    const options = {
      method,
      headers: isFormData ? this._formDataHeaders() : this._headers(),
    };
    if (data) {
      options.body = isFormData ? data : JSON.stringify(data);
    }
    try {
      const resp = await fetch(`${this.BASE}${url}`, options);
      const result = await resp.json();
      if (!resp.ok && resp.status === 401) {
        // Token过期，尝试刷新
        const refreshed = await this._tryRefresh();
        if (refreshed) {
          // 重试
          options.headers = isFormData ? this._formDataHeaders() : this._headers();
          const retryResp = await fetch(`${this.BASE}${url}`, options);
          return await retryResp.json();
        }
        // 刷新失败，跳转登录
        localStorage.clear();
        window.location.href = '/login.html';
        return null;
      }
      return result;
    } catch (err) {
      console.error('[API Error]', err);
      return { code: 500, message: '网络错误: ' + err.message };
    }
  },

  async _tryRefresh() {
    const refreshToken = localStorage.getItem('refreshToken');
    if (!refreshToken) return false;
    try {
      const resp = await fetch(`${this.BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken })
      });
      const result = await resp.json();
      if (result.code === 200 && result.data?.token) {
        localStorage.setItem('token', result.data.token);
        return true;
      }
    } catch (e) { /* ignore */ }
    return false;
  },

  // GET
  get(url) { return this._request('GET', url); },

  // POST
  post(url, data) { return this._request('POST', url, data); },

  // PUT
  put(url, data) { return this._request('PUT', url, data); },

  // DELETE
  del(url) { return this._request('DELETE', url); },

  // 上传文件 (FormData)
  upload(url, formData) { return this._request('POST', url, formData, true); },

  // ==================== 认证接口 ====================
  login(account, password) { return this.post('/auth/login', { account, password }); },
  register(data) { return this.post('/auth/register', data); },
  getProfile() { return this.get('/auth/me'); },
  changePassword(oldPwd, newPwd) { return this.put('/auth/password', { oldPassword: oldPwd, newPassword: newPwd }); },

  // ==================== 文件接口 ====================
  getFiles(params) { return this.get('/files?' + new URLSearchParams(params)); },
  getFolders(params) { return this.get('/files/folders?' + new URLSearchParams(params || {})); },
  createFolder(data) { return this.post('/files/folders', data); },
  renameFile(id, name, type) { return this.put(`/files/rename/${id}`, { name, type }); },
  moveFile(id, folderId, type) { return this.put(`/files/move/${id}`, { folder_id: folderId, type }); },
  copyFile(id, folderId) { return this.post(`/files/copy/${id}`, { folder_id: folderId }); },
  deleteFile(id) { return this.del(`/files/${id}`); },
  batchDelete(ids) { return this.post('/files/batch-delete', { ids }); },
  uploadFile(formData) { return this.upload('/files/upload', formData); },
  checkHash(md5, size) { return this.post('/files/check-hash', { md5, size }); },
  instantUpload(data) { return this.post('/files/instant', data); },
  downloadFile(id) { window.open(`/api/files/download/${id}`, '_blank'); },
  previewFile(id) { return this.get(`/files/preview/${id}`); },
  saveFile(id, content) { return this.put(`/files/save/${id}`, { content }); },
  shareFile(id, data) { return this.post(`/files/share/${id}`, data); },
  searchFiles(keyword, page) { return this.get(`/files/search?keyword=${encodeURIComponent(keyword)}&page=${page || 1}`); },
  getRecentFiles(limit) { return this.get(`/files/recent?limit=${limit || 20}`); },
  getStorageStats() { return this.get('/files/storage/stats'); },

  // ==================== 用户接口 ====================
  getUsers(params) { return this.get('/users?' + new URLSearchParams(params || {})); },
  getUser(id) { return this.get(`/users/${id}`); },
  createUser(data) { return this.post('/users', data); },
  updateUser(id, data) { return this.put(`/users/${id}`, data); },
  adminUpdateUser(id, data) { return this.put(`/users/${id}/admin`, data); },
  deleteUser(id) { return this.del(`/users/${id}`); },
  getLogs(params) { return this.get('/users/logs/operations?' + new URLSearchParams(params || {})); },

  // ==================== 群组接口 ====================
  getGroups(params) { return this.get('/groups?' + new URLSearchParams(params || {})); },
  getGroup(id) { return this.get(`/groups/${id}`); },
  createGroup(data) { return this.post('/groups', data); },
  updateGroup(id, data) { return this.put(`/groups/${id}`, data); },
  deleteGroup(id) { return this.del(`/groups/${id}`); },
  joinGroup(id) { return this.post(`/groups/${id}/join`); },
  leaveGroup(id) { return this.post(`/groups/${id}/leave`); },
  manageGroupMember(id, data) { return this.post(`/groups/${id}/members`, data); },
};
