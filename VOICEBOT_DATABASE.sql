-- =====================================================
-- VOICEBOT DATABASE SCHEMA
-- Ejecutar en phpMyAdmin en la base de datos: aloiaCcimaDB
-- =====================================================

-- Tabla de Campañas de Llamadas
CREATE TABLE IF NOT EXISTS voicebot_campaigns (
    id INT AUTO_INCREMENT PRIMARY KEY,
    campaign_name VARCHAR(255) NOT NULL,
    csv_filename VARCHAR(255),
    total_contacts INT DEFAULT 0,
    calls_completed INT DEFAULT 0,
    calls_pending INT DEFAULT 0,
    calls_failed INT DEFAULT 0,
    appointments_scheduled INT DEFAULT 0,
    status ENUM('pending', 'running', 'paused', 'completed', 'cancelled') DEFAULT 'pending',
    created_by INT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME NULL,
    completed_at DATETIME NULL,
    FOREIGN KEY (created_by) REFERENCES support_users(id) ON DELETE SET NULL,
    INDEX idx_status (status),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla de Contactos de Campaña (datos del CSV)
CREATE TABLE IF NOT EXISTS voicebot_contacts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    campaign_id INT NOT NULL,
    phone_number VARCHAR(20) NOT NULL,
    client_name VARCHAR(255),
    nave_type VARCHAR(100),
    nave_location VARCHAR(255),
    nave_size VARCHAR(50),
    nave_price VARCHAR(50),
    extra_info TEXT,
    strategic_advantages TEXT,
    call_status ENUM('pending', 'calling', 'completed', 'failed', 'no_answer', 'busy') DEFAULT 'pending',
    call_attempts INT DEFAULT 0,
    last_attempt_at DATETIME NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (campaign_id) REFERENCES voicebot_campaigns(id) ON DELETE CASCADE,
    INDEX idx_campaign (campaign_id),
    INDEX idx_call_status (call_status),
    INDEX idx_phone (phone_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla de Registros de Llamadas
CREATE TABLE IF NOT EXISTS voicebot_calls (
    id INT AUTO_INCREMENT PRIMARY KEY,
    contact_id INT NOT NULL,
    campaign_id INT NOT NULL,
    phone_number VARCHAR(20) NOT NULL,
    call_start DATETIME NOT NULL,
    call_end DATETIME NULL,
    duration_seconds INT DEFAULT 0,
    call_status ENUM('ringing', 'answered', 'completed', 'failed', 'no_answer', 'busy', 'hangup') DEFAULT 'ringing',
    asterisk_channel VARCHAR(255),
    asterisk_uniqueid VARCHAR(255),
    audio_recording_path VARCHAR(500),
    FOREIGN KEY (contact_id) REFERENCES voicebot_contacts(id) ON DELETE CASCADE,
    FOREIGN KEY (campaign_id) REFERENCES voicebot_campaigns(id) ON DELETE CASCADE,
    INDEX idx_campaign (campaign_id),
    INDEX idx_contact (contact_id),
    INDEX idx_status (call_status),
    INDEX idx_call_start (call_start),
    INDEX idx_uniqueid (asterisk_uniqueid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla de Transcripciones de Conversaciones
CREATE TABLE IF NOT EXISTS voicebot_transcriptions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    call_id INT NOT NULL,
    sequence_number INT DEFAULT 0,
    speaker ENUM('bot', 'client') NOT NULL,
    audio_chunk_path VARCHAR(500),
    transcription TEXT,
    response_text TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    confidence_score FLOAT DEFAULT 0,
    processing_time_ms INT DEFAULT 0,
    FOREIGN KEY (call_id) REFERENCES voicebot_calls(id) ON DELETE CASCADE,
    INDEX idx_call (call_id),
    INDEX idx_sequence (sequence_number),
    INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla de Citas Agendadas desde Voicebot
CREATE TABLE IF NOT EXISTS voicebot_appointments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    call_id INT NOT NULL,
    contact_id INT NOT NULL,
    campaign_id INT NOT NULL,
    phone_number VARCHAR(20) NOT NULL,
    client_name VARCHAR(255),
    appointment_date DATE NULL,
    appointment_time TIME NULL,
    appointment_datetime DATETIME NULL,
    appointment_notes TEXT,
    interest_level ENUM('high', 'medium', 'low') DEFAULT 'medium',
    agreement_reached BOOLEAN DEFAULT FALSE,
    follow_up_required BOOLEAN DEFAULT TRUE,
    status ENUM('scheduled', 'confirmed', 'cancelled', 'completed', 'no_show') DEFAULT 'scheduled',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (call_id) REFERENCES voicebot_calls(id) ON DELETE CASCADE,
    FOREIGN KEY (contact_id) REFERENCES voicebot_contacts(id) ON DELETE CASCADE,
    FOREIGN KEY (campaign_id) REFERENCES voicebot_campaigns(id) ON DELETE CASCADE,
    INDEX idx_call (call_id),
    INDEX idx_contact (contact_id),
    INDEX idx_campaign (campaign_id),
    INDEX idx_appointment_date (appointment_date),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla de Configuración del Voicebot (prompt, parámetros, etc.)
CREATE TABLE IF NOT EXISTS voicebot_config (
    id INT AUTO_INCREMENT PRIMARY KEY,
    config_key VARCHAR(100) UNIQUE NOT NULL,
    config_value TEXT,
    description VARCHAR(500),
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by INT,
    FOREIGN KEY (updated_by) REFERENCES support_users(id) ON DELETE SET NULL,
    INDEX idx_key (config_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insertar configuración por defecto del voicebot
INSERT INTO voicebot_config (config_key, config_value, description) VALUES
('system_prompt', 'Eres un asistente virtual de Navetec, especializado en venta de naves industriales. Tu objetivo es presentar las opciones disponibles al cliente, responder sus preguntas de manera profesional y amable, y si muestran interés, agendar una cita para visitar las instalaciones. Sé conciso, claro y profesional en tus respuestas.', 'Prompt del sistema para el voicebot'),
('max_call_duration', '300', 'Duración máxima de llamada en segundos (5 minutos por defecto)'),
('whisper_language', 'es', 'Idioma para Whisper STT'),
('tts_voice', 'nova', 'Voz de OpenAI TTS (alloy, echo, fable, onyx, nova, shimmer)'),
('tts_speed', '1.0', 'Velocidad de la voz TTS (0.25 a 4.0)'),
('gpt_model', 'gpt-4o', 'Modelo de GPT a utilizar'),
('gpt_temperature', '0.7', 'Temperatura del modelo GPT'),
('max_retries', '3', 'Número máximo de reintentos por contacto'),
('concurrent_calls', '2', 'Número de llamadas concurrentes permitidas'),
('recording_enabled', '1', 'Habilitar grabación de llamadas (1=sí, 0=no)');

-- =====================================================
-- VERIFICACIÓN DE INSTALACIÓN
-- =====================================================
-- Ejecutar esta query para verificar que todo se creó correctamente:
/*
SELECT
    TABLE_NAME,
    TABLE_ROWS,
    CREATE_TIME
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'aloiaCcimaDB'
  AND TABLE_NAME LIKE 'voicebot_%'
ORDER BY TABLE_NAME;
*/
