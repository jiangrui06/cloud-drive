-- ============================================================
-- 企业网盘管理系统 数据库初始化脚本
-- Cloud Drive Management System - Database Schema
-- ============================================================

CREATE DATABASE IF NOT EXISTS cloud_drive DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE cloud_drive;

-- ============================================================
-- 1. 用户表 (users)
-- ============================================================
CREATE TABLE IF NOT EXISTS `users` (
  `id`          INT UNSIGNED    NOT NULL AUTO_INCREMENT COMMENT '用户ID',
  `username`    VARCHAR(50)     NOT NULL                COMMENT '用户名',
  `password`    VARCHAR(255)    NOT NULL                COMMENT '登录密码(bcrypt加密)',
  `email`       VARCHAR(100)    DEFAULT NULL            COMMENT '电子邮箱(可用于登录)',
  `phone`       VARCHAR(20)     DEFAULT NULL            COMMENT '手机号(可用于登录)',
  `avatar`      VARCHAR(255)    DEFAULT NULL            COMMENT '头像URL',
  `nickname`    VARCHAR(50)     DEFAULT NULL            COMMENT '昵称',
  `role`        ENUM('admin','user') NOT NULL DEFAULT 'user' COMMENT '角色: admin管理员, user普通用户',
  `status`      TINYINT(1)      NOT NULL DEFAULT 1      COMMENT '状态: 1启用, 0禁用',
  `total_storage` BIGINT UNSIGNED NOT NULL DEFAULT 109951162777600 COMMENT '总存储空间(字节), 默认100TB',
  `used_storage`  BIGINT UNSIGNED NOT NULL DEFAULT 0    COMMENT '已用存储空间(字节)',
  `last_login`  DATETIME        DEFAULT NULL            COMMENT '最后登录时间',
  `login_ip`    VARCHAR(45)     DEFAULT NULL            COMMENT '最后登录IP',
  `created_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_username` (`username`),
  UNIQUE KEY `uk_email` (`email`),
  UNIQUE KEY `uk_phone` (`phone`),
  KEY `idx_role` (`role`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表';

-- ============================================================
-- 2. 群组表 (groups)
-- ============================================================
CREATE TABLE IF NOT EXISTS `groups` (
  `id`          INT UNSIGNED    NOT NULL AUTO_INCREMENT COMMENT '群组ID',
  `name`        VARCHAR(100)    NOT NULL                COMMENT '群组名称',
  `description` VARCHAR(500)    DEFAULT NULL            COMMENT '群组描述',
  `owner_id`    INT UNSIGNED    NOT NULL                COMMENT '创建者(用户ID)',
  `type`        ENUM('private','public') NOT NULL DEFAULT 'private' COMMENT '类型: private私有, public公开',
  `max_members` INT UNSIGNED    NOT NULL DEFAULT 50     COMMENT '最大成员数',
  `status`      TINYINT(1)      NOT NULL DEFAULT 1      COMMENT '状态: 1启用, 0禁用',
  `created_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_name` (`name`),
  KEY `idx_owner` (`owner_id`),
  CONSTRAINT `fk_group_owner` FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='群组表';

-- ============================================================
-- 3. 用户-群组关联表 (user_groups)
-- ============================================================
CREATE TABLE IF NOT EXISTS `user_groups` (
  `id`          INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  `user_id`     INT UNSIGNED    NOT NULL,
  `group_id`    INT UNSIGNED    NOT NULL,
  `role`        ENUM('owner','admin','member') NOT NULL DEFAULT 'member' COMMENT '在群组中的角色',
  `joined_at`   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_group` (`user_id`, `group_id`),
  KEY `idx_group` (`group_id`),
  CONSTRAINT `fk_ug_user`  FOREIGN KEY (`user_id`)  REFERENCES `users`  (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ug_group` FOREIGN KEY (`group_id`) REFERENCES `groups` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户-群组关联表';

-- ============================================================
-- 4. 文件夹表 (folders)
-- ============================================================
CREATE TABLE IF NOT EXISTS `folders` (
  `id`          INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  `name`        VARCHAR(255)    NOT NULL                COMMENT '文件夹名称',
  `parent_id`   INT UNSIGNED    DEFAULT NULL            COMMENT '父文件夹ID(NULL为根目录)',
  `owner_id`    INT UNSIGNED    NOT NULL                COMMENT '所属用户ID',
  `group_id`    INT UNSIGNED    DEFAULT NULL            COMMENT '所属群组ID(共享文件夹)',
  `is_shared`   TINYINT(1)      NOT NULL DEFAULT 0      COMMENT '是否共享',
  `permission`  VARCHAR(20)     DEFAULT 'private'       COMMENT '权限: private, group, public',
  `created_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_parent` (`parent_id`),
  KEY `idx_owner`  (`owner_id`),
  KEY `idx_group`  (`group_id`),
  CONSTRAINT `fk_folder_parent` FOREIGN KEY (`parent_id`) REFERENCES `folders` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_folder_owner`  FOREIGN KEY (`owner_id`)  REFERENCES `users`   (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文件夹表';

-- ============================================================
-- 5. 文件表 (files) - 核心表，支持秒传
-- ============================================================
CREATE TABLE IF NOT EXISTS `files` (
  `id`            INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  `name`          VARCHAR(255)    NOT NULL                COMMENT '文件名',
  `size`          BIGINT UNSIGNED NOT NULL DEFAULT 0      COMMENT '文件大小(字节)',
  `mime_type`     VARCHAR(100)    DEFAULT NULL            COMMENT 'MIME类型',
  `md5`           VARCHAR(32)     DEFAULT NULL            COMMENT '文件MD5哈希(用于秒传)',
  `sha256`        VARCHAR(64)     DEFAULT NULL            COMMENT '文件SHA256哈希',
  `storage_path`  VARCHAR(500)    NOT NULL                COMMENT '存储路径',
  `extension`     VARCHAR(20)     DEFAULT NULL            COMMENT '文件扩展名',
  `folder_id`     INT UNSIGNED    DEFAULT NULL            COMMENT '所属文件夹ID',
  `owner_id`      INT UNSIGNED    NOT NULL                COMMENT '上传者(用户ID)',
  `group_id`      INT UNSIGNED    DEFAULT NULL            COMMENT '所属群组ID',
  `is_shared`     TINYINT(1)      NOT NULL DEFAULT 0      COMMENT '是否共享',
  `permission`    VARCHAR(20)     DEFAULT 'private'       COMMENT '权限: private, group, public',
  `download_count` INT UNSIGNED   NOT NULL DEFAULT 0      COMMENT '下载次数',
  `is_deleted`    TINYINT(1)      NOT NULL DEFAULT 0      COMMENT '软删除标记',
  `version`       INT UNSIGNED    NOT NULL DEFAULT 1      COMMENT '版本号',
  `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_md5`       (`md5`),
  KEY `idx_owner`     (`owner_id`),
  KEY `idx_folder`    (`folder_id`),
  KEY `idx_group`     (`group_id`),
  KEY `idx_deleted`   (`is_deleted`),
  UNIQUE KEY `uk_folder_filename` (`folder_id`, `name`, `is_deleted`),
  CONSTRAINT `fk_file_folder` FOREIGN KEY (`folder_id`) REFERENCES `folders` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_file_owner`  FOREIGN KEY (`owner_id`)  REFERENCES `users`   (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文件表';

-- ============================================================
-- 6. 文件版本表 (file_versions) - 支持版本管理
-- ============================================================
CREATE TABLE IF NOT EXISTS `file_versions` (
  `id`            INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  `file_id`       INT UNSIGNED    NOT NULL,
  `version`       INT UNSIGNED    NOT NULL                COMMENT '版本号',
  `size`          BIGINT UNSIGNED NOT NULL                COMMENT '文件大小',
  `md5`           VARCHAR(32)     DEFAULT NULL            COMMENT '文件MD5',
  `storage_path`  VARCHAR(500)    NOT NULL                COMMENT '存储路径',
  `uploader_id`   INT UNSIGNED    NOT NULL                COMMENT '上传者',
  `change_note`   VARCHAR(500)    DEFAULT NULL            COMMENT '变更说明',
  `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_file_version` (`file_id`, `version`),
  CONSTRAINT `fk_fv_file` FOREIGN KEY (`file_id`) REFERENCES `files` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文件版本表';

-- ============================================================
-- 7. 分享链接表 (share_links)
-- ============================================================
CREATE TABLE IF NOT EXISTS `share_links` (
  `id`            INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  `code`          VARCHAR(32)     NOT NULL                COMMENT '分享码(短链接标识)',
  `file_id`       INT UNSIGNED    DEFAULT NULL            COMMENT '分享的文件ID',
  `folder_id`     INT UNSIGNED    DEFAULT NULL            COMMENT '分享的文件夹ID',
  `owner_id`      INT UNSIGNED    NOT NULL                COMMENT '分享者',
  `password`      VARCHAR(255)    DEFAULT NULL            COMMENT '提取密码(空为无密码)',
  `expire_time`   DATETIME        DEFAULT NULL            COMMENT '过期时间(NULL为永久)',
  `max_downloads` INT UNSIGNED    DEFAULT NULL            COMMENT '最大下载次数',
  `download_count` INT UNSIGNED   NOT NULL DEFAULT 0      COMMENT '当前下载次数',
  `permission`    ENUM('view','download','edit') NOT NULL DEFAULT 'download' COMMENT '分享权限',
  `status`        TINYINT(1)      NOT NULL DEFAULT 1      COMMENT '状态: 1有效, 0禁用',
  `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_code` (`code`),
  KEY `idx_file`   (`file_id`),
  KEY `idx_owner`  (`owner_id`),
  KEY `idx_expire` (`expire_time`),
  CONSTRAINT `fk_sl_file`  FOREIGN KEY (`file_id`)   REFERENCES `files`  (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_sl_folder` FOREIGN KEY (`folder_id`) REFERENCES `folders`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_sl_owner` FOREIGN KEY (`owner_id`)  REFERENCES `users`  (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='分享链接表';

-- ============================================================
-- 8. 登录日志表 (login_logs)
-- ============================================================
CREATE TABLE IF NOT EXISTS `login_logs` (
  `id`            INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  `user_id`       INT UNSIGNED    DEFAULT NULL            COMMENT '用户ID(登录失败时为NULL)',
  `username`      VARCHAR(50)     NOT NULL                COMMENT '登录用户名',
  `login_method`  VARCHAR(20)     NOT NULL                COMMENT '登录方式: password, email, phone',
  `login_ip`      VARCHAR(45)     NOT NULL                COMMENT '登录IP',
  `user_agent`    VARCHAR(500)    DEFAULT NULL            COMMENT 'User-Agent',
  `status`        TINYINT(1)      NOT NULL                COMMENT '状态: 1成功, 0失败',
  `fail_reason`   VARCHAR(255)    DEFAULT NULL            COMMENT '失败原因',
  `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user`  (`user_id`),
  KEY `idx_time`  (`created_at`),
  KEY `idx_ip`    (`login_ip`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='登录日志表';

-- ============================================================
-- 9. 操作日志表 (operation_logs) - 审计日志
-- ============================================================
CREATE TABLE IF NOT EXISTS `operation_logs` (
  `id`            INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  `user_id`       INT UNSIGNED    DEFAULT NULL            COMMENT '操作用户ID',
  `username`      VARCHAR(50)     DEFAULT NULL            COMMENT '操作用户名',
  `action`        VARCHAR(50)     NOT NULL                COMMENT '操作类型: upload, download, delete, rename, move, share, edit, etc.',
  `target_type`   VARCHAR(20)     DEFAULT NULL            COMMENT '操作对象类型: file, folder, user, group',
  `target_id`     INT UNSIGNED    DEFAULT NULL            COMMENT '操作对象ID',
  `target_name`   VARCHAR(255)    DEFAULT NULL            COMMENT '操作对象名称',
  `detail`        JSON            DEFAULT NULL            COMMENT '操作详情(JSON)',
  `ip_address`    VARCHAR(45)     DEFAULT NULL            COMMENT '操作IP',
  `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user`  (`user_id`),
  KEY `idx_action` (`action`),
  KEY `idx_time`  (`created_at`),
  KEY `idx_target` (`target_type`, `target_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='操作日志表(审计)';

-- ============================================================
-- 10. 系统配置表 (system_config)
-- ============================================================
CREATE TABLE IF NOT EXISTS `system_config` (
  `id`            INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  `config_key`    VARCHAR(100)    NOT NULL                COMMENT '配置键',
  `config_value`  TEXT            NOT NULL                COMMENT '配置值',
  `description`   VARCHAR(500)    DEFAULT NULL            COMMENT '配置说明',
  `updated_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_config_key` (`config_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统配置表';

-- ============================================================
-- 插入默认数据
-- ============================================================

-- 默认管理员: admin / admin123456 (请在生产环境修改密码)
INSERT INTO `users` (`username`, `password`, `email`, `phone`, `nickname`, `role`, `status`) VALUES
('admin', '$2a$10$BGQgm909SaEgraAPGsuL1uXnLAERTcmG1D/8HtvmMBFfdS.l2pTDO', 'admin@clouddrive.com', '13800000000', '系统管理员', 'admin', 1);

-- 默认系统配置
INSERT INTO `system_config` (`config_key`, `config_value`, `description`) VALUES
('max_file_size', '104857600', '单文件最大上传大小(字节)，默认100MB'),
('allowed_extensions', 'jpg,jpeg,png,gif,bmp,doc,docx,xls,xlsx,ppt,pptx,pdf,txt,zip,rar,7z,mp4,mp3,avi,wav', '允许上传的文件扩展名'),
('default_storage_per_user', '109951162777600', '用户默认存储空间(字节)，默认100TB'),
('site_name', '企业云盘', '站点名称'),
('maintenance_mode', '0', '维护模式: 1开启, 0关闭');

-- ============================================================
-- 创建存储过程: 统计用户存储使用情况
-- ============================================================
DELIMITER //
CREATE PROCEDURE IF NOT EXISTS `sp_calc_user_storage`(IN p_user_id INT UNSIGNED)
BEGIN
  DECLARE v_used BIGINT UNSIGNED DEFAULT 0;
  SELECT IFNULL(SUM(size), 0) INTO v_used FROM files WHERE owner_id = p_user_id AND is_deleted = 0;
  UPDATE users SET used_storage = v_used WHERE id = p_user_id;
END//

-- 创建存储过程: 文件秒传检查
CREATE PROCEDURE IF NOT EXISTS `sp_check_file_exists`(IN p_md5 VARCHAR(32))
BEGIN
  SELECT id, name, size, storage_path, mime_type FROM files WHERE md5 = p_md5 AND is_deleted = 0 LIMIT 1;
END//

DELIMITER ;

-- ============================================================
-- 完成
-- ============================================================
SELECT 'Database initialization completed successfully!' AS status;
