const database = require('./database');
const logger = require('./logger');
const config = require('../config/config');
const sessionManager = require('./sessionManager');
const userDataManager = require('./userDataManager');

class FollowUpManager {
    constructor() {
        this.followUps = new Map(); // Cache local para seguimientos activos
        this.checkInterval = 2 * 60 * 60 * 1000; // 2 horas (revisión en producción)
        this.followUpInterval = 24 * 60 * 60 * 1000; // 24 horas entre seguimientos
        this.timerInterval = null; // Referencia al interval para poder limpiarlo
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
            console.log(`[FollowUp] 🔍 Intentando iniciar seguimiento para ${userId}`);

            // Verificar si ya existe un seguimiento activo
            const existing = await database.findOne('follow_ups', 'user_id = ? AND status = "active"', [userId]);

            if (existing) {
                console.log(`[FollowUp] ⚠️ Seguimiento ya activo para usuario ${userId}`);
                return;
            }

            // Crear nuevo seguimiento
            const now = new Date();
            console.log(`[FollowUp] 📝 Insertando en BD para ${userId}...`);

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
            console.log(`[FollowUp] ✅ Seguimiento iniciado exitosamente para ${userId}`);
            console.log(`[FollowUp] 📊 Total seguimientos activos: ${this.followUps.size}`);
        } catch (error) {
            console.error(`[FollowUp] ❌ Error iniciando seguimiento para ${userId}:`, error);
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

            // Limpiar contexto completo cuando la conversación termina,
            // excepto si el usuario volvió a escribir (seguirá conversando)
            if (reason !== 'volvio_activo' && reason !== 'modo_humano_activo') {
                console.log(`[FollowUp] 🧹 Limpiando contexto completo para ${userId} (razón: ${reason})`);
                await sessionManager.clearSession(userId);
                await userDataManager.deleteUserData(userId);
            }
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

    isWithinAllowedHours() {
        const nowMexico = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
        const hour = nowMexico.getHours();
        return hour >= 9 && hour < 19; // 9:00 AM a 6:59 PM
    }

    async checkPendingFollowUps(sock, aiService, sessionManager) {
        const now = Date.now();
        console.log(`[FollowUp] 🔄 Revisando seguimientos pendientes... Total activos: ${this.followUps.size}`);

        if (!this.isWithinAllowedHours()) {
            const nowMexico = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
            console.log(`[FollowUp] ⏰ Fuera de horario permitido (9AM-7PM CDMX). Hora actual: ${nowMexico.getHours()}:${String(nowMexico.getMinutes()).padStart(2, '0')}. Se omite envío.`);
            return;
        }

        for (const [userId, followUp] of this.followUps.entries()) {
            try {
                // Verificar si han pasado 24 horas desde el último seguimiento
                const timeSinceLastFollowUp = now - followUp.lastFollowUp;
                const hoursSinceLastFollowUp = Math.floor(timeSinceLastFollowUp / (60 * 60 * 1000));

                console.log(`[FollowUp] Usuario ${userId}:`);
                console.log(`  - Tiempo desde último seguimiento: ${hoursSinceLastFollowUp} horas`);
                console.log(`  - Contador de seguimientos: ${followUp.followUpCount}`);
                console.log(`  - Intervalo requerido: 24 horas`);

                if (timeSinceLastFollowUp >= this.followUpInterval) {
                    console.log(`  - ✅ Tiempo cumplido, verificando estado de conversación...`);

                    // VERIFICACIÓN CRÍTICA: Analizar el estado de la conversación antes de enviar
                    const messages = await sessionManager.getMessages(userId);
                    const lastUserMessage = messages.filter(m => m.role === 'user').slice(-1)[0];

                    if (lastUserMessage) {
                        const conversationStatus = await aiService.analyzeConversationStatus(
                            messages,
                            lastUserMessage.content
                        );

                        console.log(`  - 🔍 Estado detectado: ${conversationStatus}`);

                        // Si el cliente ya rechazó, aceptó o está frustrado, NO enviar seguimiento
                        if (['ACEPTADO', 'RECHAZADO', 'FRUSTRADO'].includes(conversationStatus)) {
                            console.log(`  - 🛑 SEGUIMIENTO CANCELADO: Cliente en estado ${conversationStatus}`);
                            await this.stopFollowUp(userId, conversationStatus.toLowerCase());
                            continue; // Saltar al siguiente usuario
                        }
                    }

                    // Generar mensaje de seguimiento usando IA
                    const followUpResult = await this.generateFollowUpMessage(
                        userId,
                        followUp.followUpCount,
                        aiService,
                        sessionManager
                    );

                    console.log(`  - 📝 Mensaje generado: "${followUpResult.message.substring(0, 50)}..."`);

                    // Verificar si se debe detener el seguimiento
                    if (followUpResult.shouldStop) {
                        console.log(`  - 🛑 La IA determinó que no se debe continuar el seguimiento`);
                        await this.stopFollowUp(userId, 'ia_determino_detener');
                        continue;
                    }

                    // Enviar mensaje
                    if (followUp.chatId && sock) {
                        console.log(`  - 📤 Enviando mensaje a ${followUp.chatId}...`);
                        await sock.sendMessage(followUp.chatId, { text: followUpResult.message });
                        await logger.log('BOT', followUpResult.message, userId);

                        // Guardar mensaje de seguimiento en el historial de sesión
                        await sessionManager.addMessage(userId, 'assistant', followUpResult.message, followUp.chatId);

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

                        console.log(`  - ✅ Mensaje de seguimiento #${followUp.followUpCount} enviado exitosamente`);
                    } else {
                        console.log(`  - ❌ No se pudo enviar: chatId=${followUp.chatId}, sock=${!!sock}`);
                    }
                } else {
                    const hoursRemaining = Math.ceil((this.followUpInterval - timeSinceLastFollowUp) / (60 * 60 * 1000));
                    console.log(`  - ⏳ Faltan ${hoursRemaining} horas para el siguiente seguimiento`);
                }
            } catch (error) {
                console.error(`[FollowUp] ❌ Error procesando seguimiento para ${userId}:`, error);
            }
        }

        if (this.followUps.size === 0) {
            console.log(`[FollowUp] 📭 No hay seguimientos activos`);
        }
    }

    async generateFollowUpMessage(userId, followUpCount, aiService, sessionManager) {
        try {
            // Obtener historial de conversación
            const messages = await sessionManager.getMessages(userId);

            // VERIFICACIÓN CRÍTICA: Analizar si el cliente ya dio señales de rechazo o aceptación
            const lastUserMessage = messages.filter(m => m.role === 'user').slice(-1)[0];

            if (lastUserMessage) {
                const detectionPrompt = {
                    role: 'system',
                    content: `Analiza esta conversación y determina si el cliente ha dado señales claras de:
1. RECHAZO: Dijo "no me interesa", "no gracias", "no es para mí", "ya no quiero más información"
2. ACEPTACIÓN: Pidió agendar cita, proporcionó datos de contacto, confirmó interés explícito
3. FRUSTRACIÓN: Pide que dejen de contactarlo, muestra enojo, se queja de insistencia
4. CONTINUAR: Ninguna de las anteriores (cliente puede seguir interesado)

Responde ÚNICAMENTE con: RECHAZO, ACEPTACIÓN, FRUSTRACIÓN, o CONTINUAR`
                };

                const detectionUserPrompt = {
                    role: 'user',
                    content: `Analiza si este cliente debe seguir recibiendo seguimientos.`
                };

                const detectionMessages = [detectionPrompt, ...messages, detectionUserPrompt];
                const detectionResponse = await aiService.generateResponse(detectionMessages);
                const shouldContinue = detectionResponse.trim().toUpperCase();

                console.log(`  - 🔍 Análisis de continuación: ${shouldContinue}`);

                // Si NO debe continuar, retornar sin mensaje
                if (['RECHAZO', 'ACEPTACIÓN', 'FRUSTRACIÓN'].includes(shouldContinue)) {
                    return {
                        message: '[No se genera mensaje de seguimiento - el cliente ha solicitado explícitamente no recibir más contactos]',
                        shouldStop: true
                    };
                }
            }

            // Si pasa la verificación, generar mensaje de seguimiento
            const systemPrompt = {
                role: 'system',
                content: `Eres Daniel de Navetec. El cliente dejó de responder hace 24 horas.

Esta es la conversación #${followUpCount + 1} de seguimiento.

ANÁLISIS PREVIO: Ya verificamos que el cliente NO ha rechazado explícitamente ni está frustrado.

IMPORTANTE:
- NO uses emojis
- Sé breve y profesional
- Retoma el contexto de la conversación anterior
- Si es el primer seguimiento (count 0): pregunta si aún está interesado y si tiene dudas
- Si es el segundo seguimiento (count 1): ofrece alternativas o menciona beneficios adicionales
- Si es el tercer seguimiento (count 2 o mayor): menciona que es el último contacto y ofrece dejar información de contacto directo
- Máximo 2-3 líneas

Genera SOLO el mensaje de seguimiento, sin explicaciones adicionales.`
            };

            const userPrompt = {
                role: 'user',
                content: 'Genera un mensaje de seguimiento apropiado basado en la conversación anterior.'
            };

            const aiMessages = [systemPrompt, ...messages, userPrompt];
            const response = await aiService.generateResponse(aiMessages);

            // Si es el tercer seguimiento o superior, marcar para detener después de este
            const shouldStopAfter = followUpCount >= 2;

            return {
                message: response,
                shouldStop: shouldStopAfter
            };
        } catch (error) {
            console.error('Error generando mensaje de seguimiento:', error);

            // Fallback a mensajes predefinidos
            const fallbackMessages = [
                'Hola, quería darle seguimiento a nuestra conversación anterior. ¿Aún está interesado en conocer más sobre nuestras naves industriales? ¿Tiene alguna duda que pueda resolver?',
                'Hola nuevamente. Veo que no hemos continuado con la conversación. ¿Le gustaría conocer otras opciones disponibles o recibir información adicional sobre algún parque industrial específico?',
                'Hola, este será mi último mensaje de seguimiento. Si desea información adicional, estamos a su disposición.'
            ];

            const shouldStopAfter = followUpCount >= 2;

            return {
                message: fallbackMessages[Math.min(followUpCount, 2)],
                shouldStop: shouldStopAfter
            };
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
        // Limpiar interval existente si hay uno
        if (this.timerInterval) {
            console.log('[FollowUp] ⚠️ Limpiando timer existente antes de crear uno nuevo');
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }

        console.log('✓ Timer de seguimiento iniciado (revisión cada 2 horas)');
        console.log(`✓ Intervalo de seguimiento: 24 horas`);

        this.timerInterval = setInterval(() => {
            this.checkPendingFollowUps(sock, aiService, sessionManager);
        }, this.checkInterval);
    }

    async getAllActiveFollowUps() {
        return Array.from(this.followUps.values());
    }
}

module.exports = new FollowUpManager();
