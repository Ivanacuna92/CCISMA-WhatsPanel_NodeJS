const config = require('../config/config');
const logger = require('./logger');
const humanModeManager = require('./humanModeManager');
const database = require('./database');

class SessionManager {
    constructor() {
        this.localCache = new Map(); // Cache local para rendimiento
        this.cleanupTimerInterval = null; // Referencia al interval de limpieza
        this.syncTimerInterval = null; // Referencia al interval de sincronización
    }

    async getSession(userId, chatId = null) {
        // Verificar cache local primero
        if (this.localCache.has(userId)) {
            const session = this.localCache.get(userId);
            if (chatId) session.chatId = chatId;
            session.lastActivity = Date.now();
            return session;
        }

        try {
            // Buscar en base de datos
            const dbSession = await database.findOne('user_sessions', 'user_id = ?', [userId]);

            if (dbSession) {
                const session = {
                    messages: JSON.parse(dbSession.messages || '[]'),
                    lastActivity: Date.now(),
                    chatId: chatId || dbSession.chat_id, // Usar chatId de BD si no se proporciona uno nuevo
                    mode: 'ai'
                };
                this.localCache.set(userId, session);

                // Actualizar última actividad y chat_id en BD si es necesario
                const updateData = { last_activity: new Date() };
                if (chatId && chatId !== dbSession.chat_id) {
                    updateData.chat_id = chatId;
                }

                await database.update('user_sessions',
                    updateData,
                    'user_id = ?',
                    [userId]
                );

                return session;
            } else {
                // Crear nueva sesión
                const session = {
                    messages: [],
                    lastActivity: Date.now(),
                    chatId: chatId,
                    mode: 'ai'
                };

                await database.insert('user_sessions', {
                    user_id: userId,
                    chat_id: chatId,
                    messages: '[]',
                    last_activity: new Date()
                });

                this.localCache.set(userId, session);
                return session;
            }
        } catch (error) {
            console.error('Error obteniendo sesión de BD:', error);
            // Fallback a cache local si hay error de BD
            const session = {
                messages: [],
                lastActivity: Date.now(),
                chatId: chatId,
                mode: 'ai'
            };
            this.localCache.set(userId, session);
            return session;
        }
    }

    async addMessage(userId, role, content, chatId = null) {
        const session = await this.getSession(userId, chatId);
        session.messages.push({ role, content, timestamp: new Date().toISOString() });
        session.lastActivity = Date.now();

        // Actualizar en cache local
        this.localCache.set(userId, session);

        // Actualizar en base de datos
        try {
            const updateData = {
                messages: JSON.stringify(session.messages),
                last_activity: new Date()
            };

            // Actualizar chat_id si se proporciona y es diferente
            if (chatId && chatId !== session.chatId) {
                updateData.chat_id = chatId;
                session.chatId = chatId;
            }

            await database.update('user_sessions',
                updateData,
                'user_id = ?',
                [userId]
            );
        } catch (error) {
            console.error('Error actualizando mensajes en BD:', error);
        }
    }

    async getMessages(userId, chatId = null) {
        const session = await this.getSession(userId, chatId);
        return session.messages.slice(-config.maxMessages);
    }

    async clearSession(userId) {
        // Eliminar del cache local completamente
        this.localCache.delete(userId);

        // Eliminar de base de datos
        try {
            await database.query(
                'DELETE FROM user_sessions WHERE user_id = ?',
                [userId]
            );
            console.log(`[SessionManager] 🧹 Sesión eliminada completamente para ${userId}`);
        } catch (error) {
            console.error('Error limpiando sesión en BD:', error);
        }
    }
    
    async updateSessionMode(userId, chatId, mode) {
        const session = await this.getSession(userId, chatId);
        session.mode = mode;
        session.lastActivity = Date.now();
        this.localCache.set(userId, session);
    }
    
    async getSessionMode(userId) {
        if (this.localCache.has(userId)) {
            return this.localCache.get(userId).mode || 'ai';
        }
        
        try {
            const dbSession = await database.findOne('user_sessions', 'user_id = ?', [userId]);
            if (dbSession) {
                return 'ai'; // Por defecto AI si existe sesión
            }
        } catch (error) {
            console.error('Error obteniendo modo de sesión:', error);
        }
        
        return 'ai';
    }

    async checkInactiveSessions(sock, followUpManager) {
        const now = Date.now();
        console.log(`[SessionManager] Verificando sesiones inactivas... Total en cache: ${this.localCache.size}`);

        // Verificar sesiones en cache local
        for (const [userId, session] of this.localCache.entries()) {
            const inactiveTime = now - session.lastActivity;
            const inactiveMinutes = Math.floor(inactiveTime / 60000);

            console.log(`[SessionManager] Usuario ${userId}:`);
            console.log(`  - Tiempo inactivo: ${inactiveMinutes} minutos`);
            console.log(`  - Mensajes en sesión: ${session.messages.length}`);

            // Si está en modo humano o soporte, NO limpiar la sesión por inactividad
            const isHuman = await humanModeManager.isHumanMode(userId);
            const isSupport = await humanModeManager.isSupportMode(userId);

            if (isHuman || isSupport) {
                console.log(`  - ⚠️ En modo ${isSupport ? 'SOPORTE' : 'HUMANO'} - saltando`);
                continue;
            }

            // Verificar si han pasado 5 minutos de inactividad
            if (now - session.lastActivity > config.sessionTimeout && session.messages.length > 0) {
                console.log(`  - ✅ Cumple con timeout de 5 minutos`);

                // Verificar si ya hay un seguimiento activo
                const hasActiveFollowUp = followUpManager ? await followUpManager.isFollowUpActive(userId) : false;
                console.log(`  - Seguimiento activo existente: ${hasActiveFollowUp}`);

                if (!hasActiveFollowUp && followUpManager) {
                    console.log(`  - 🚀 INICIANDO SEGUIMIENTO para ${userId}`);

                    // Validar que tengamos un chatId antes de iniciar el seguimiento
                    if (!session.chatId) {
                        console.log(`  - ❌ No se puede iniciar seguimiento: chatId es null para usuario ${userId}`);
                        console.log(`  - 💡 Esto puede ocurrir si la sesión se cargó desde BD sin chatId`);
                    } else {
                        // NO enviar mensaje de finalización
                        // En su lugar, iniciar seguimiento automático
                        await followUpManager.startFollowUp(userId, session.chatId);
                        await logger.log('SYSTEM', 'Seguimiento automático iniciado por inactividad de 5 minutos', userId);
                    }
                } else {
                    console.log(`  - ⏭️ Seguimiento ya existe o followUpManager no disponible`);
                }

                // NO limpiar la sesión - mantener el contexto para los seguimientos
            } else {
                console.log(`  - ⏳ No cumple timeout aún (necesita ${5 - inactiveMinutes} minutos más)`);
            }
        }

        // Limpiar sesiones antiguas de la BD (más de 7 días sin actividad y sin seguimiento activo)
        try {
            await database.query(
                'DELETE FROM user_sessions WHERE last_activity < DATE_SUB(NOW(), INTERVAL 7 DAY)'
            );
        } catch (error) {
            console.error('Error limpiando sesiones antiguas de BD:', error);
        }
    }

    startCleanupTimer(sock, followUpManager = null) {
        // Limpiar interval existente si hay uno
        if (this.cleanupTimerInterval) {
            console.log('[SessionManager] ⚠️ Limpiando timer de limpieza existente antes de crear uno nuevo');
            clearInterval(this.cleanupTimerInterval);
            this.cleanupTimerInterval = null;
        }

        this.cleanupTimerInterval = setInterval(() => {
            this.checkInactiveSessions(sock, followUpManager);
        }, config.checkInterval);
    }
    
    // Método para sincronizar cache con BD periódicamente
    async syncCacheWithDB() {
        for (const [userId, session] of this.localCache.entries()) {
            try {
                await database.update('user_sessions',
                    {
                        messages: JSON.stringify(session.messages),
                        chat_id: session.chatId,
                        last_activity: new Date(session.lastActivity)
                    },
                    'user_id = ?',
                    [userId]
                );
            } catch (error) {
                console.error(`Error sincronizando sesión ${userId}:`, error);
            }
        }
    }
    
    // Iniciar sincronización periódica
    startSyncTimer() {
        // Limpiar interval existente si hay uno
        if (this.syncTimerInterval) {
            console.log('[SessionManager] ⚠️ Limpiando timer de sincronización existente antes de crear uno nuevo');
            clearInterval(this.syncTimerInterval);
            this.syncTimerInterval = null;
        }

        this.syncTimerInterval = setInterval(() => {
            this.syncCacheWithDB();
        }, 30000); // Sincronizar cada 30 segundos
    }
}

module.exports = new SessionManager();