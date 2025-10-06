const database = require('./database');
const logger = require('./logger');
const config = require('../config/config');

class FollowUpManager {
    constructor() {
        this.followUps = new Map(); // Cache local para seguimientos activos
        this.checkInterval = 60 * 1000; // 1 minuto (revisión frecuente para pruebas)
        this.followUpInterval = 10 * 60 * 1000; // 10 minutos entre seguimientos (modo pruebas)
        // Para producción usar: 24 * 60 * 60 * 1000 (24 horas)
    }

    async initialize() {
        try {
            // Cargar seguimientos activos desde BD al iniciar
            const activeFollowUps = await database.query(
                'SELECT * FROM follow_ups WHERE status = "active"'
            );

            for (const followUp of activeFollowUps) {
                this.followUps.set(followUp.user_id, {
                    userId: followUp.user_id,
                    chatId: followUp.chat_id,
                    lastFollowUp: new Date(followUp.last_follow_up).getTime(),
                    followUpCount: followUp.follow_up_count,
                    status: followUp.status,
                    startedAt: new Date(followUp.started_at).getTime()
                });
            }

            console.log(`✓ FollowUpManager inicializado con ${activeFollowUps.length} seguimientos activos`);
        } catch (error) {
            console.error('Error inicializando FollowUpManager:', error);
        }
    }

    async startFollowUp(userId, chatId) {
        try {
            // Verificar si ya existe un seguimiento activo
            const existing = await database.findOne('follow_ups', 'user_id = ? AND status = "active"', [userId]);

            if (existing) {
                console.log(`Seguimiento ya activo para usuario ${userId}`);
                return;
            }

            // Crear nuevo seguimiento
            const now = new Date();
            await database.insert('follow_ups', {
                user_id: userId,
                chat_id: chatId,
                last_follow_up: now,
                follow_up_count: 0,
                status: 'active',
                started_at: now
            });

            // Agregar a cache local
            this.followUps.set(userId, {
                userId,
                chatId,
                lastFollowUp: now.getTime(),
                followUpCount: 0,
                status: 'active',
                startedAt: now.getTime()
            });

            await logger.log('SYSTEM', 'Seguimiento automático iniciado', userId);
            console.log(`✓ Seguimiento iniciado para usuario ${userId}`);
        } catch (error) {
            console.error('Error iniciando seguimiento:', error);
        }
    }

    async stopFollowUp(userId, reason = 'manual') {
        try {
            // Actualizar en BD
            await database.update('follow_ups',
                {
                    status: 'stopped',
                    stopped_reason: reason,
                    stopped_at: new Date()
                },
                'user_id = ? AND status = "active"',
                [userId]
            );

            // Remover de cache local
            this.followUps.delete(userId);

            await logger.log('SYSTEM', `Seguimiento detenido: ${reason}`, userId);
            console.log(`✓ Seguimiento detenido para usuario ${userId}: ${reason}`);
        } catch (error) {
            console.error('Error deteniendo seguimiento:', error);
        }
    }

    async isFollowUpActive(userId) {
        return this.followUps.has(userId);
    }

    async getFollowUpStatus(userId) {
        return this.followUps.get(userId) || null;
    }

    async checkPendingFollowUps(sock, aiService, sessionManager) {
        const now = Date.now();

        for (const [userId, followUp] of this.followUps.entries()) {
            try {
                // Verificar si han pasado 10 minutos desde el último seguimiento (modo pruebas)
                const timeSinceLastFollowUp = now - followUp.lastFollowUp;

                if (timeSinceLastFollowUp >= this.followUpInterval) {
                    // Generar mensaje de seguimiento usando IA
                    const followUpMessage = await this.generateFollowUpMessage(
                        userId,
                        followUp.followUpCount,
                        aiService,
                        sessionManager
                    );

                    // Enviar mensaje
                    if (followUp.chatId && sock) {
                        await sock.sendMessage(followUp.chatId, { text: followUpMessage });
                        await logger.log('BOT', followUpMessage, userId);

                        // Actualizar contador y timestamp
                        followUp.followUpCount++;
                        followUp.lastFollowUp = now;

                        // Actualizar en BD
                        await database.update('follow_ups',
                            {
                                last_follow_up: new Date(),
                                follow_up_count: followUp.followUpCount
                            },
                            'user_id = ?',
                            [userId]
                        );

                        // Actualizar cache
                        this.followUps.set(userId, followUp);

                        console.log(`✓ Mensaje de seguimiento #${followUp.followUpCount} enviado a ${userId}`);
                    }
                }
            } catch (error) {
                console.error(`Error procesando seguimiento para ${userId}:`, error);
            }
        }
    }

    async generateFollowUpMessage(userId, followUpCount, aiService, sessionManager) {
        try {
            // Obtener historial de conversación
            const messages = await sessionManager.getMessages(userId);

            // Crear prompt para generar mensaje de seguimiento
            const systemPrompt = {
                role: 'system',
                content: `Eres Daniel de Navetec. El cliente dejó de responder hace 24 horas.

Esta es la conversación #${followUpCount + 1} de seguimiento.

IMPORTANTE:
- NO uses emojis
- Sé breve y profesional
- Retoma el contexto de la conversación anterior
- Si es el primer seguimiento (count 0): pregunta si aún está interesado y si tiene dudas
- Si es el segundo seguimiento (count 1): ofrece alternativas o menciona beneficios adicionales
- Si es el tercer seguimiento (count 2): menciona que es el último contacto y ofrece dejar información de contacto directo
- Máximo 2-3 líneas

Genera SOLO el mensaje de seguimiento, sin explicaciones adicionales.`
            };

            const userPrompt = {
                role: 'user',
                content: 'Genera un mensaje de seguimiento apropiado basado en la conversación anterior.'
            };

            const aiMessages = [systemPrompt, ...messages, userPrompt];
            const response = await aiService.generateResponse(aiMessages);

            return response;
        } catch (error) {
            console.error('Error generando mensaje de seguimiento:', error);

            // Fallback a mensajes predefinidos
            const fallbackMessages = [
                'Hola, quería darle seguimiento a nuestra conversación anterior. ¿Aún está interesado en conocer más sobre nuestras naves industriales? ¿Tiene alguna duda que pueda resolver?',
                'Hola nuevamente. Veo que no hemos continuado con la conversación. ¿Le gustaría conocer otras opciones disponibles o recibir información adicional sobre algún parque industrial específico?',
                'Hola, este será mi último mensaje de seguimiento. Si desea información adicional, puede contactar directamente a Paola González al 4424634736 o al correo paola.gonzalez@grupoccima.com.mx. Estamos a su disposición.'
            ];

            return fallbackMessages[Math.min(followUpCount, 2)];
        }
    }

    async analyzeConversationStatus(userId, lastMessage, aiService, sessionManager) {
        try {
            // Obtener historial completo
            const messages = await sessionManager.getMessages(userId);

            // Crear prompt para analizar el estado
            const analysisPrompt = {
                role: 'system',
                content: `Analiza esta conversación y determina si se cumple alguna de estas condiciones:

1. ACEPTADO: El cliente mostró intención clara de proceder (pidió cita, proporcionó correo, dijo que sí está interesado)
2. RECHAZADO: El cliente rechazó explícitamente la oferta (dijo "no me interesa", "no gracias", "no es para mí")
3. FRUSTRADO: El cliente muestra frustración o enojo (usa lenguaje negativo, se queja, menciona insistencia molesta)
4. ACTIVO: La conversación sigue activa y productiva
5. INACTIVO: El cliente dejó de responder sin señales claras

Responde ÚNICAMENTE con una de estas palabras: ACEPTADO, RECHAZADO, FRUSTRADO, ACTIVO, o INACTIVO`
            };

            const userPrompt = {
                role: 'user',
                content: `Último mensaje del cliente: "${lastMessage}"\n\nAnaliza el estado de la conversación.`
            };

            const aiMessages = [analysisPrompt, ...messages, userPrompt];
            const response = await aiService.generateResponse(aiMessages);

            const status = response.trim().toUpperCase();

            // Manejar el resultado
            if (['ACEPTADO', 'RECHAZADO', 'FRUSTRADO'].includes(status)) {
                await this.stopFollowUp(userId, status.toLowerCase());
                return status;
            }

            return status;
        } catch (error) {
            console.error('Error analizando estado de conversación:', error);
            return 'ACTIVO'; // Default a activo en caso de error
        }
    }

    startFollowUpTimer(sock, aiService, sessionManager) {
        console.log('✓ Timer de seguimiento iniciado (revisión cada minuto - modo pruebas)');
        console.log(`✓ Intervalo de seguimiento: ${this.followUpInterval / 60000} minutos`);

        setInterval(() => {
            this.checkPendingFollowUps(sock, aiService, sessionManager);
        }, this.checkInterval);
    }

    async getAllActiveFollowUps() {
        return Array.from(this.followUps.values());
    }
}

module.exports = new FollowUpManager();
