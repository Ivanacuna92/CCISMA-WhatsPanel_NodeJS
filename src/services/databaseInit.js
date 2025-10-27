const database = require('./database');

class DatabaseInit {
    async createTables() {
        try {
            await database.connect();
            
            // Crear tabla de logs de conversaciones
            await database.query(`
                CREATE TABLE IF NOT EXISTS conversation_logs (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    timestamp DATETIME NOT NULL,
                    user_id VARCHAR(50),
                    user_name VARCHAR(255),
                    message TEXT,
                    response TEXT,
                    role VARCHAR(20),
                    support_user_id VARCHAR(50),
                    session_id VARCHAR(100),
                    is_human_response BOOLEAN DEFAULT FALSE,
                    INDEX idx_timestamp (timestamp),
                    INDEX idx_user_id (user_id),
                    INDEX idx_role (role)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);

            // Crear tabla de usuarios de soporte
            await database.query(`
                CREATE TABLE IF NOT EXISTS support_users (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    email VARCHAR(255) UNIQUE NOT NULL,
                    password_hash VARCHAR(255) NOT NULL,
                    name VARCHAR(255),
                    role ENUM('admin', 'support', 'viewer') DEFAULT 'support',
                    active BOOLEAN DEFAULT TRUE,
                    last_login DATETIME,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    INDEX idx_email (email)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);

            // Crear tabla de sesiones de soporte
            await database.query(`
                CREATE TABLE IF NOT EXISTS support_sessions (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    session_token VARCHAR(255) UNIQUE NOT NULL,
                    user_id INT NOT NULL,
                    expires_at DATETIME NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES support_users(id) ON DELETE CASCADE,
                    INDEX idx_token (session_token),
                    INDEX idx_expires (expires_at)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);

            // Crear tabla de sesiones de usuarios de WhatsApp
            await database.query(`
                CREATE TABLE IF NOT EXISTS user_sessions (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    user_id VARCHAR(50) UNIQUE NOT NULL,
                    chat_id VARCHAR(255) NULL,
                    messages TEXT,
                    last_activity DATETIME NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_user_id (user_id),
                    INDEX idx_chat_id (chat_id),
                    INDEX idx_last_activity (last_activity)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);

            // Agregar columna chat_id si no existe (para instalaciones existentes)
            try {
                await database.query(`
                    ALTER TABLE user_sessions
                    ADD COLUMN IF NOT EXISTS chat_id VARCHAR(255) NULL AFTER user_id
                `);
            } catch (error) {
                // Ignorar error si la columna ya existe
                if (!error.message.includes('Duplicate column')) {
                    console.log('Nota: chat_id ya existe en user_sessions o error al agregar:', error.message);
                }
            }

            // Agregar índice para chat_id si no existe
            try {
                await database.query(`
                    ALTER TABLE user_sessions
                    ADD INDEX IF NOT EXISTS idx_chat_id (chat_id)
                `);
            } catch (error) {
                // Ignorar error si el índice ya existe
                if (!error.message.includes('Duplicate key')) {
                    console.log('Nota: índice idx_chat_id ya existe o error al agregar:', error.message);
                }
            }

            // Crear tabla de estados de modo humano/soporte
            await database.query(`
                CREATE TABLE IF NOT EXISTS human_mode_states (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    contact_id VARCHAR(50) UNIQUE NOT NULL,
                    is_human_mode BOOLEAN DEFAULT FALSE,
                    mode VARCHAR(20) DEFAULT 'ai',
                    activated_at DATETIME,
                    activated_by VARCHAR(100),
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    INDEX idx_contact_id (contact_id),
                    INDEX idx_mode (mode)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);

            // Insertar usuario admin por defecto si no existe
            const adminExists = await database.findOne('support_users', 'email = ?', ['admin@whatspanel.com']);
            if (!adminExists) {
                const bcrypt = require('bcrypt');
                const hashedPassword = await bcrypt.hash('admin123', 10);
                await database.insert('support_users', {
                    email: 'admin@whatspanel.com',
                    password_hash: hashedPassword,
                    name: 'Administrador',
                    role: 'admin',
                    active: true
                });
                console.log('✅ Usuario admin creado: admin@whatspanel.com / admin123');
            }

            console.log('✅ Tablas de base de datos verificadas/creadas');
            return true;
        } catch (error) {
            console.error('❌ Error inicializando base de datos:', error);
            throw error;
        }
    }
}

module.exports = new DatabaseInit();