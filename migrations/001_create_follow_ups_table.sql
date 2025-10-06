-- Tabla para gestionar seguimientos automáticos de clientes
CREATE TABLE IF NOT EXISTS follow_ups (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    chat_id VARCHAR(255) NOT NULL,
    last_follow_up DATETIME NOT NULL,
    follow_up_count INT DEFAULT 0,
    status ENUM('active', 'stopped') DEFAULT 'active',
    stopped_reason VARCHAR(255) NULL,
    stopped_at DATETIME NULL,
    started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_user_id (user_id),
    INDEX idx_status (status),
    INDEX idx_last_follow_up (last_follow_up)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
