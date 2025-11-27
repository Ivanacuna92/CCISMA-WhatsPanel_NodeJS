const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');
const { parse } = require('csv-parse/sync');
const voicebotDB = require('./voicebotDatabase');
const ariManager = require('./ariManager');
const openaiVoice = require('./openaiVoice');
const audioHandler = require('./audioHandler');

class CampaignManager extends EventEmitter {
    constructor() {
        super();
        this.activeCampaigns = new Map();
        this.maxConcurrentCalls = parseInt(process.env.VOICEBOT_CONCURRENT_CALLS) || 2;
        this.activeCallsCount = 0;
        this.callHandlers = new Map();
        this.commonResponses = new Map(); // Respuestas pre-cacheadas
    }

    async initialize() {
        // RESET al iniciar
        this.activeCallsCount = 0;
        this.callHandlers.clear();
        console.log('🔄 Contador de llamadas reseteado');

        // Conectar a Asterisk ARI
        console.log('🔌 Conectando a Asterisk ARI...');
        await ariManager.connect();

        // Inicializar audio handler
        console.log('🎤 Inicializando Audio Handler...');
        await audioHandler.initialize();

        // Escuchar llamadas contestadas desde ARI
        ariManager.on('callAnswered', (callData) => {
            this.handleCallAnswered(callData);
        });

        // Escuchar llamadas fallidas
        ariManager.on('callFailed', (data) => {
            console.log(`📴 Llamada fallida detectada: ${data.reason}`);
            // El timeout de 45s se encargará de limpiar el slot
        });

        // Limpiar grabaciones antiguas cada hora
        setInterval(() => {
            audioHandler.cleanupOldRecordings();
        }, 60 * 60 * 1000);

        // Pre-generar respuestas comunes
        console.log('💬 Pre-generando respuestas comunes...');
        await this.preGenerateCommonResponses();

        console.log('✅ Campaign Manager inicializado con ARI');
    }

    // Pre-genera respuestas comunes para respuestas instantáneas
    async preGenerateCommonResponses() {
        const responses = {
            // Despedidas
            'despedida_positiva': 'Perfecto, entonces te espero. Que tengas buen día.',
            'despedida_negativa': 'Entendido, gracias por tu tiempo. Que tengas buen día.',
            // Confirmaciones de cita
            'confirmar_hora': '¿A qué hora te quedaría bien?',
            'confirmar_dia': '¿Qué día te acomoda mejor?',
            'cita_agendada': 'Perfecto, te agendo. Te esperamos.',
            // Manejo de problemas de audio
            'no_escuche': '¿Podrías repetirme eso?',
            'habla_mas_fuerte': '¿Podrías hablar un poco más fuerte?',
            // Respuestas a días específicos
            'si_manana': 'Perfecto, mañana entonces. ¿A qué hora te queda bien?',
            'si_lunes': 'Perfecto, el lunes entonces. ¿A qué hora te queda bien?',
            'si_martes': 'Perfecto, el martes entonces. ¿A qué hora te queda bien?',
            'si_miercoles': 'Perfecto, el miércoles entonces. ¿A qué hora te queda bien?',
            'si_jueves': 'Perfecto, el jueves entonces. ¿A qué hora te queda bien?',
            'si_viernes': 'Perfecto, el viernes entonces. ¿A qué hora te queda bien?',
            // Respuestas a preguntas comunes
            'mas_info': '¿Qué te gustaría saber?',
            'donde_ubicada': 'La nave está muy bien ubicada, cerca de vías principales. ¿Te gustaría visitarla?',
            'como_agendar': 'Solo dime qué día y hora te acomodan y listo.',
            // Continuación de conversación
            'entendido': 'Entendido.',
            'ok_continuo': 'De acuerdo, te cuento más.'
        };

        const asteriskSoundsPath = '/usr/share/asterisk/sounds/custom';

        for (const [key, text] of Object.entries(responses)) {
            const filename = `common_${key}`;
            const pcmPath = `/tmp/${filename}.pcm`;
            const wavPath = `${asteriskSoundsPath}/${filename}.wav`;

            try {
                // Verificar si ya existe
                try {
                    await fs.access(wavPath);
                    this.commonResponses.set(key, `custom/${filename}`);
                    continue;
                } catch (e) {
                    // No existe, generarlo
                }

                await openaiVoice.textToSpeech(text, pcmPath);
                await audioHandler.convertForAsteriskPlaybackDirect(pcmPath, wavPath);
                this.commonResponses.set(key, `custom/${filename}`);
                console.log(`   ✅ Respuesta común: "${key}"`);
            } catch (error) {
                console.error(`   ❌ Error generando respuesta común ${key}:`, error.message);
            }
        }

        console.log(`💬 ${this.commonResponses.size} respuestas comunes pre-generadas`);
    }

    // Verifica que las respuestas comunes estén cargadas (para paralelizar con Whisper)
    async ensureCommonResponsesLoaded() {
        if (this.commonResponses.size === 0) {
            console.log('⚠️ Respuestas comunes no cargadas, regenerando...');
            await this.preGenerateCommonResponses();
        }
        return true;
    }

    // Detecta si el texto del cliente coincide con una respuesta común pre-cacheada
    // Retorna el key de la respuesta o null
    detectCommonResponse(clientText) {
        const text = clientText.toLowerCase().trim();

        // Detectar días específicos
        if (/\b(mañana|manana)\b/i.test(text) && /\b(sí|si|claro|va|dale|ok|está bien|esta bien)\b/i.test(text)) {
            return 'si_manana';
        }
        if (/\blunes\b/i.test(text)) return 'si_lunes';
        if (/\bmartes\b/i.test(text)) return 'si_martes';
        if (/\b(miércoles|miercoles)\b/i.test(text)) return 'si_miercoles';
        if (/\bjueves\b/i.test(text)) return 'si_jueves';
        if (/\bviernes\b/i.test(text)) return 'si_viernes';

        // Detectar confirmación de hora (cliente da una hora)
        if (/\b(\d{1,2})\s*(am|pm|de la mañana|de la tarde)?\b/i.test(text) &&
            !/\b(no|ocupado|después)\b/i.test(text)) {
            return 'cita_agendada';
        }

        // Detectar pregunta de ubicación
        if (/\b(dónde|donde|ubicación|ubicacion|dirección|direccion)\b/i.test(text)) {
            return 'donde_ubicada';
        }

        // Detectar pregunta de más información
        if (/\b(más|mas|info|información|informacion|detalles|cuéntame|cuentame)\b/i.test(text) &&
            text.length < 30) {
            return 'mas_info';
        }

        // Detectar despedida negativa
        if (/\b(no gracias|no me interesa|no puedo|ocupado|después|despues|luego)\b/i.test(text)) {
            return 'despedida_negativa';
        }

        return null;
    }

    // ==================== GESTIÓN DE CAMPAÑAS ====================

    async createCampaignFromCSV(csvFilePath, campaignName, createdBy) {
        try {
            console.log(`📄 Procesando CSV: ${csvFilePath}`);

            // Leer y parsear CSV
            const fileContent = await fs.readFile(csvFilePath, 'utf-8');
            const records = parse(fileContent, {
                columns: true,
                skip_empty_lines: true,
                trim: true
            });

            if (records.length === 0) {
                throw new Error('El CSV no contiene registros válidos');
            }

            // Crear campaña
            const campaignId = await voicebotDB.createCampaign({
                campaignName: campaignName,
                csvFilename: path.basename(csvFilePath),
                totalContacts: records.length,
                createdBy: createdBy
            });

            console.log(`✅ Campaña creada: ID ${campaignId}`);

            // Agregar contactos
            let addedCount = 0;
            for (const record of records) {
                // Buscar precio en varias columnas posibles
                const rawPrice = record['Precio (MXN)'] || record['Precio(MXN)'] || record.Precio || record.Price || '';
                const rawSize = record['Tamaño (m2)'] || record['Tamaño(m2)'] || record.Tamaño || record.Size || '';

                console.log(`📋 Parseando contacto: ${record.Nombre}, Precio raw: "${rawPrice}", Tamaño raw: "${rawSize}"`);

                await voicebotDB.addContact(campaignId, {
                    phone: this.cleanPhoneNumber(record.Teléfono || record.Telefono || record.Phone),
                    name: record.Nombre || record.Name || 'Cliente',
                    naveType: record['Tipo de Nave'] || record['Tipo'] || '',
                    location: record.Ubicación || record.Ubicacion || record.Location || '',
                    size: rawSize,
                    price: rawPrice,
                    extraInfo: record['Información Adicional'] || record.Info || '',
                    advantages: record['Ventajas Estratégicas'] || record.Ventajas || ''
                });
                addedCount++;
            }

            console.log(`✅ ${addedCount} contactos agregados a la campaña`);

            return {
                success: true,
                campaignId: campaignId,
                contactsAdded: addedCount
            };
        } catch (error) {
            console.error('❌ Error creando campaña:', error);
            throw error;
        }
    }

    cleanPhoneNumber(phone) {
        if (!phone) return '';

        // Remover espacios, guiones, paréntesis
        let cleaned = phone.toString().replace(/[\s\-\(\)]/g, '');

        // Si empieza con +52, removerlo
        if (cleaned.startsWith('+52')) {
            cleaned = cleaned.substring(3);
        } else if (cleaned.startsWith('52')) {
            cleaned = cleaned.substring(2);
        }

        // Tomar solo los últimos 10 dígitos
        if (cleaned.length > 10) {
            cleaned = cleaned.substring(cleaned.length - 10);
        }

        return cleaned;
    }

    async startCampaign(campaignId) {
        try {
            const campaign = await voicebotDB.getCampaign(campaignId);

            if (!campaign) {
                throw new Error('Campaña no encontrada');
            }

            if (campaign.status === 'running') {
                throw new Error('La campaña ya está en ejecución');
            }

            // Actualizar estado
            await voicebotDB.updateCampaignStatus(campaignId, 'running');

            // Iniciar procesamiento de llamadas
            this.activeCampaigns.set(campaignId, {
                id: campaignId,
                status: 'running',
                startTime: new Date()
            });

            console.log(`🚀 Campaña ${campaignId} iniciada`);

            // Procesar llamadas en cola
            this.processCallQueue(campaignId);

            return { success: true, message: 'Campaña iniciada' };
        } catch (error) {
            console.error('❌ Error iniciando campaña:', error);
            throw error;
        }
    }

    async pauseCampaign(campaignId) {
        await voicebotDB.updateCampaignStatus(campaignId, 'paused');
        const campaign = this.activeCampaigns.get(campaignId);
        if (campaign) {
            campaign.status = 'paused';
        }
        console.log(`⏸️  Campaña ${campaignId} pausada`);
    }

    async stopCampaign(campaignId) {
        await voicebotDB.updateCampaignStatus(campaignId, 'completed');
        this.activeCampaigns.delete(campaignId);
        console.log(`⏹️  Campaña ${campaignId} detenida`);
    }

    // ==================== COLA DE LLAMADAS ====================

    async processCallQueue(campaignId) {
        const campaign = this.activeCampaigns.get(campaignId);

        if (!campaign || campaign.status !== 'running') {
            console.log(`⏹️  Campaña ${campaignId} no está activa`);
            return;
        }

        // Validar que el contador no sea negativo (bug fix)
        if (this.activeCallsCount < 0) {
            console.log(`⚠️ Contador negativo detectado, reseteando a 0`);
            this.activeCallsCount = 0;
        }

        // Verificar límite de llamadas concurrentes
        if (this.activeCallsCount >= this.maxConcurrentCalls) {
            console.log(`⏳ Esperando slot... (${this.activeCallsCount}/${this.maxConcurrentCalls})`);
            setTimeout(() => this.processCallQueue(campaignId), 5000);
            return;
        }

        console.log(`📞 Procesando cola - Slots disponibles: ${this.maxConcurrentCalls - this.activeCallsCount}`);

        // Obtener siguiente contacto pendiente
        const pendingContacts = await voicebotDB.getPendingContacts(campaignId, 1);

        if (pendingContacts.length === 0) {
            console.log(`✅ No hay más contactos pendientes en campaña ${campaignId}`);
            await this.stopCampaign(campaignId);
            return;
        }

        const contact = pendingContacts[0];

        // Iniciar llamada
        await this.makeCall(contact);

        // Esperar un poco antes de procesar el siguiente
        setTimeout(() => this.processCallQueue(campaignId), 2000);
    }

    async makeCall(contact) {
        try {
            console.log(`📞 Iniciando llamada a ${contact.phone_number}`);

            // Marcar contacto como "calling"
            await voicebotDB.updateContactStatus(contact.id, 'calling');
            await voicebotDB.incrementCallAttempts(contact.id);

            this.activeCallsCount++;

            // Originar llamada via ARI
            const result = await ariManager.originateCall(
                contact.phone_number,
                'voicebot-ari'
            );

            console.log(`✅ Llamada originada via ARI: ${contact.phone_number}`);
            console.log(`📊 Llamadas activas: ${this.activeCallsCount}/${this.maxConcurrentCalls}`);

            // Guardar handler para esta llamada (usando phoneNumber como key)
            this.callHandlers.set(contact.phone_number, {
                contact: contact,
                startTime: new Date(),
                timeout: null
            });

            // TIMEOUT: Si en 45 segundos no contestan, liberar el slot
            const callTimeout = setTimeout(() => {
                const handler = this.callHandlers.get(contact.phone_number);
                if (handler && !handler.answered) {
                    console.log(`⏰ Timeout: ${contact.phone_number} no contestó en 45s`);
                    this.handleCallTimeout(contact.phone_number);
                }
            }, 45000);

            // Guardar referencia al timeout
            const handler = this.callHandlers.get(contact.phone_number);
            if (handler) handler.timeout = callTimeout;

            return result;
        } catch (error) {
            console.error(`❌ Error haciendo llamada a ${contact.phone_number}:`, error);

            this.activeCallsCount--;
            console.log(`📊 Llamadas activas: ${this.activeCallsCount}/${this.maxConcurrentCalls}`);
            await voicebotDB.updateContactStatus(contact.id, 'failed');

            throw error;
        }
    }

    // ==================== MANEJO DE LLAMADAS ARI ====================

    // Manejar timeout de llamada no contestada
    async handleCallTimeout(phoneNumber) {
        const handler = this.callHandlers.get(phoneNumber);
        if (!handler) return;

        console.log(`📴 Liberando slot por timeout: ${phoneNumber}`);

        // Marcar contacto como no_answer
        try {
            await voicebotDB.updateContactStatus(handler.contact.id, 'no_answer');
        } catch (err) {
            console.error('Error actualizando estado:', err);
        }

        // Limpiar
        this.callHandlers.delete(phoneNumber);
        this.activeCallsCount--;
        console.log(`📊 Llamadas activas: ${this.activeCallsCount}/${this.maxConcurrentCalls}`);
    }

    async handleCallAnswered(callData) {
        const { channelId, bridgeId, phoneNumber, channel, bridge } = callData;

        console.log(`🎯 Llamada contestada (ARI): ${phoneNumber}`);
        console.log(`   Canal: ${channelId}`);
        console.log(`   Puente: ${bridgeId}`);

        try {
            // Buscar información del contacto
            const callHandler = this.callHandlers.get(phoneNumber);

            if (!callHandler) {
                console.error('⚠️  No se encontró información del contacto para esta llamada');
                this.activeCallsCount--;
                console.log(`📊 Llamadas activas: ${this.activeCallsCount}/${this.maxConcurrentCalls}`);
                await ariManager.hangup(channelId);
                return;
            }

            // Marcar como contestada y cancelar timeout
            callHandler.answered = true;
            if (callHandler.timeout) {
                clearTimeout(callHandler.timeout);
                callHandler.timeout = null;
            }

            const contact = callHandler.contact;

            // Crear registro de llamada en BD
            const dbCallId = await voicebotDB.createCall({
                contactId: contact.id,
                campaignId: contact.campaign_id,
                phoneNumber: contact.phone_number,
                channel: channelId,
                uniqueId: channelId
            });

            // Actualizar estado
            await voicebotDB.updateCallStatus(dbCallId, 'answered');
            await voicebotDB.updateContactStatus(contact.id, 'completed');

            console.log(`✅ Registro de llamada creado: ${dbCallId}`);

            // Iniciar conversación
            await this.handleConversation(channelId, bridgeId, contact, dbCallId);

            // Colgar
            await ariManager.hangup(channelId);

            // Finalizar llamada
            await voicebotDB.updateCallStatus(dbCallId, 'completed', new Date());

            this.activeCallsCount--;
            console.log(`📊 Llamadas activas: ${this.activeCallsCount}/${this.maxConcurrentCalls}`);

            // Limpiar handler
            this.callHandlers.delete(phoneNumber);

        } catch (error) {
            console.error('❌ Error manejando llamada contestada:', error);
            this.activeCallsCount--;
            console.log(`📊 Llamadas activas: ${this.activeCallsCount}/${this.maxConcurrentCalls}`);
            // Limpiar handler en caso de error también
            this.callHandlers.delete(phoneNumber);
        }
    }

    async handleConversation(channelId, bridgeId, contact, callId) {
        console.log(`💬 Iniciando conversación con ${contact.client_name || contact.phone_number}`);

        const conversationId = `call_${callId}`;
        let turnCount = 0;
        const maxTurns = 8; // Máximo 8 intercambios
        const startTime = Date.now();

        // Contexto del cliente
        const context = {
            clientName: contact.client_name,
            naveType: contact.nave_type,
            naveLocation: contact.nave_location,
            naveSize: contact.nave_size,
            navePrice: contact.nave_price,
            extraInfo: contact.extra_info,
            strategicAdvantages: contact.strategic_advantages
        };

        // Pre-construir el pitch de la nave
        const pitch = this.buildNavePitch(contact);
        let preCachedPitchAudio = null;

        try {
            // ===== SALUDO INICIAL (solo pregunta si tiene un momento) =====
            const greeting = `Hola ${contact.client_name || ''}, te llamo de Navetec. Tenemos una nave industrial que podría interesarte. ¿Tienes un momento para que te cuente?`;

            // Iniciar pre-generación del pitch EN PARALELO con el saludo
            const pitchPreGenPromise = this.preGeneratePitchAudio(pitch, callId);

            await this.speakToClient(bridgeId, greeting, callId, turnCount++, 'bot', conversationId);

            // IMPORTANTE: Agregar el saludo al historial para que GPT sepa que ya se hizo
            openaiVoice.addToConversationHistory(conversationId, 'assistant', greeting);

            // Esperar a que termine la pre-generación (si no terminó durante el saludo)
            try {
                preCachedPitchAudio = await pitchPreGenPromise;
                console.log(`✅ Pitch pre-generado listo: ${preCachedPitchAudio}`);
            } catch (err) {
                console.log('⚠️ Pre-generación falló, se generará en tiempo real');
            }

            // ===== CICLO DE CONVERSACIÓN =====
            let isFirstResponse = true; // Para usar el audio pre-generado
            while (turnCount < maxTurns) {
                // Verificar timeout (5 minutos máximo)
                const elapsedTime = (Date.now() - startTime) / 1000;
                const maxDuration = parseInt(process.env.VOICEBOT_MAX_CALL_DURATION) || 300;

                if (elapsedTime > maxDuration) {
                    console.log('⏰ Tiempo máximo de llamada alcanzado');
                    break;
                }

                // ===== ESCUCHAR AL CLIENTE =====
                console.log(`👂 Esperando respuesta del cliente (turno ${turnCount})...`);

                const audioPath = audioHandler.generateAudioPath(callId, turnCount, 'input');

                // Grabar respuesta (3s max, corta con 0.3s de silencio)
                const recordedPath = await ariManager.recordAudioFromBridge(
                    bridgeId,
                    audioPath,
                    3
                );

                if (!recordedPath) {
                    console.log('⚠️  No se pudo grabar audio');
                    break;
                }

                // ===== TRANSCRIBIR EN PARALELO CON VERIFICACIÓN DE RESPUESTAS =====
                const processStartTime = Date.now();
                let transcription;
                try {
                    // Ejecutar Whisper Y verificar respuestas comunes en paralelo
                    const whisperStart = Date.now();
                    const [whisperResult, _] = await Promise.all([
                        openaiVoice.transcribeAudio(recordedPath),
                        this.ensureCommonResponsesLoaded() // Verificar que estén listas
                    ]);
                    transcription = whisperResult;
                    console.log(`⚡ Whisper: ${Date.now() - whisperStart}ms`);
                } catch (error) {
                    console.error('❌ Error transcribiendo:', error);
                    // Pedir que repita
                    await this.speakToClient(
                        bridgeId,
                        'Perdona, no te escuché bien. ¿Podrías repetir?',
                        callId,
                        turnCount++,
                        'bot',
                        conversationId
                    );
                    continue;
                }

                if (!transcription || !transcription.text || transcription.text.trim() === '') {
                    console.log('⚠️  Transcripción vacía');
                    await this.speakToClient(
                        bridgeId,
                        '¿Podrías hablar más cerca del teléfono?',
                        callId,
                        turnCount++,
                        'bot',
                        conversationId
                    );
                    continue;
                }

                console.log(`📝 Cliente dijo: "${transcription.text}"`);

                // Guardar transcripción del cliente (async, no esperar)
                voicebotDB.addTranscription(callId, {
                    sequence: turnCount,
                    speaker: 'client',
                    audioPath: recordedPath,
                    text: transcription.text,
                    confidence: 0.95,
                    processingTime: Date.now() - processStartTime
                }).catch(err => console.error('Error guardando transcripción:', err));

                // ===== PRIMERA RESPUESTA: USAR AUDIO PRE-CACHEADO =====
                if (isFirstResponse && preCachedPitchAudio) {
                    isFirstResponse = false;
                    const clientText = transcription.text.toLowerCase();

                    // Detectar respuesta positiva o negativa
                    const isPositive = /\b(sí|si|claro|ok|está bien|esta bien|dale|va|por favor|porfavor|dime|cuéntame|cuentame|adelante|bueno|sale|órale|orale)\b/i.test(clientText);
                    const isNegative = /\b(no|ocupado|después|despues|luego|ahora no|no puedo|no gracias|cuelgo)\b/i.test(clientText);

                    if (isPositive) {
                        console.log('✅ Respuesta positiva detectada - usando audio pre-cacheado');

                        // Reproducir audio pre-generado directamente (SIN GPT, SIN TTS)
                        const filename = path.basename(preCachedPitchAudio, '.wav');
                        await ariManager.playAudio(bridgeId, `custom/${filename}`);

                        // Agregar al historial
                        openaiVoice.addToConversationHistory(conversationId, 'user', transcription.text);
                        openaiVoice.addToConversationHistory(conversationId, 'assistant', pitch);

                        console.log(`⚡ Respuesta instantánea con audio pre-cacheado`);
                        turnCount++;
                        continue;
                    } else if (isNegative) {
                        console.log('❌ Respuesta negativa detectada - despedida rápida');
                        await this.speakToClient(
                            bridgeId,
                            'Entendido, gracias por tu tiempo. Que tengas buen día.',
                            callId,
                            turnCount++,
                            'bot',
                            conversationId
                        );
                        break;
                    }
                    // Si no es claramente positivo ni negativo, continuar con GPT
                }
                isFirstResponse = false;

                // ===== DETECTAR RESPUESTAS COMUNES PARA RESPUESTA INSTANTÁNEA =====
                const detectedCommon = this.detectCommonResponse(transcription.text);

                if (detectedCommon) {
                    const commonAudio = this.commonResponses.get(detectedCommon);
                    if (commonAudio) {
                        console.log(`⚡ Respuesta común detectada: ${detectedCommon}`);

                        // Obtener el texto de la respuesta para el historial
                        const responseTexts = {
                            'si_manana': 'Perfecto, mañana entonces. ¿A qué hora te queda bien?',
                            'si_lunes': 'Perfecto, el lunes entonces. ¿A qué hora te queda bien?',
                            'si_martes': 'Perfecto, el martes entonces. ¿A qué hora te queda bien?',
                            'si_miercoles': 'Perfecto, el miércoles entonces. ¿A qué hora te queda bien?',
                            'si_jueves': 'Perfecto, el jueves entonces. ¿A qué hora te queda bien?',
                            'si_viernes': 'Perfecto, el viernes entonces. ¿A qué hora te queda bien?',
                            'cita_agendada': 'Perfecto, te agendo. Te esperamos.',
                            'confirmar_dia': '¿Qué día te acomoda mejor?',
                            'confirmar_hora': '¿A qué hora te quedaría bien?',
                            'donde_ubicada': 'La nave está muy bien ubicada, cerca de vías principales. ¿Te gustaría visitarla?',
                            'mas_info': '¿Qué te gustaría saber?',
                            'despedida_negativa': 'Entendido, gracias por tu tiempo. Que tengas buen día.'
                        };

                        await ariManager.playAudio(bridgeId, commonAudio);
                        openaiVoice.addToConversationHistory(conversationId, 'user', transcription.text);
                        openaiVoice.addToConversationHistory(conversationId, 'assistant', responseTexts[detectedCommon] || '');

                        // Si es despedida, terminar
                        if (detectedCommon === 'despedida_negativa') {
                            console.log('👋 Despedida detectada');
                            break;
                        }

                        turnCount++;
                        continue;
                    }
                }

                // Detectar si quiere agendar (respuesta instantánea) - fallback
                const clientTextLower = transcription.text.toLowerCase();
                if (/\b(sí|si|claro|me interesa|quiero|va|dale|por supuesto)\b/i.test(clientTextLower) &&
                    /\b(visita|ver|conocer|agendar|cita)\b/i.test(clientTextLower)) {
                    console.log('⚡ Respuesta común detectada: quiere agendar');
                    const commonAudio = this.commonResponses.get('confirmar_dia');
                    if (commonAudio) {
                        await ariManager.playAudio(bridgeId, commonAudio);
                        openaiVoice.addToConversationHistory(conversationId, 'user', transcription.text);
                        openaiVoice.addToConversationHistory(conversationId, 'assistant', '¿Qué día te acomoda mejor?');
                        turnCount++;
                        continue;
                    }
                }

                // ===== GENERAR RESPUESTA CON GPT =====
                const gptStart = Date.now();

                let aiResponse;
                try {
                    aiResponse = await openaiVoice.generateResponse(
                        transcription.text,
                        conversationId,
                        null,
                        context
                    );
                    console.log(`⚡ GPT: ${Date.now() - gptStart}ms`);
                } catch (error) {
                    console.error('❌ Error generando respuesta:', error);
                    await this.speakToClient(
                        bridgeId,
                        'Disculpa, permíteme continuar.',
                        callId,
                        turnCount++,
                        'bot',
                        conversationId
                    );
                    continue;
                }

                console.log(`💬 Bot: "${aiResponse.text}"`);
                console.log(`⚡ TOTAL proceso: ${Date.now() - processStartTime}ms`);

                // ===== HABLAR AL CLIENTE (TTS + REPRODUCIR) =====
                await this.speakToClient(bridgeId, aiResponse.text, callId, turnCount++, 'bot', conversationId, aiResponse.text);

                // Verificar si es despedida
                const lowerResponse = aiResponse.text.toLowerCase();
                if (lowerResponse.includes('gracias por tu tiempo') ||
                    lowerResponse.includes('que tengas buen día') ||
                    lowerResponse.includes('hasta luego') ||
                    lowerResponse.includes('adiós')) {
                    console.log('👋 Despedida detectada, finalizando conversación');
                    break;
                }
            }

            // ===== ANÁLISIS POST-CONVERSACIÓN (SIEMPRE SE EJECUTA) =====
            await this.analyzeAndSaveAppointment(conversationId, callId, contact);

            console.log(`✅ Conversación finalizada con ${contact.client_name || contact.phone_number}`);

        } catch (error) {
            console.error('❌ Error en conversación:', error);
            // IMPORTANTE: Aún con error, intentar analizar la conversación
            console.log('⚠️ Intentando análisis a pesar del error...');
            try {
                await this.analyzeAndSaveAppointment(conversationId, callId, contact);
            } catch (analysisError) {
                console.error('❌ Error también en análisis post-error:', analysisError);
                openaiVoice.clearConversationContext(conversationId);
            }
            throw error;
        }
    }

    async speakToClient(bridgeId, text, callId, sequence, speaker, conversationId, responseText = null) {
        console.log(`🔊 Bot: ${text}`);

        const startTime = Date.now();

        try {
            // ===== GENERAR AUDIO DIRECTO EN ASTERISK =====
            const asteriskSoundsPath = '/usr/share/asterisk/sounds/custom';
            await fs.mkdir(asteriskSoundsPath, { recursive: true });

            const filename = `tts_${callId}_${sequence}_${Date.now()}`;
            const tempPcmPath = `/tmp/${filename}.pcm`;
            const finalWavPath = `${asteriskSoundsPath}/${filename}.wav`;

            // TTS directo a PCM (mejor calidad que MP3)
            await openaiVoice.textToSpeech(text, tempPcmPath);

            // Convertir PCM 24kHz a WAV 8kHz para Asterisk
            await audioHandler.convertForAsteriskPlaybackDirect(tempPcmPath, finalWavPath);

            // Reproducir inmediatamente
            await ariManager.playAudio(bridgeId, `custom/${filename}`);

            // ===== GUARDAR TRANSCRIPCIÓN =====
            const processingTime = Date.now() - startTime;
            console.log(`⚡ Tiempo de respuesta: ${processingTime}ms`);

            await voicebotDB.addTranscription(callId, {
                sequence: sequence,
                speaker: speaker,
                audioPath: finalWavPath,
                text: text,
                response: responseText,
                confidence: 1.0,
                processingTime: processingTime
            });

            console.log(`✅ Bot habló (${processingTime}ms)`);

        } catch (error) {
            console.error('❌ Error hablando al cliente:', error);

            // Fallback: usar audio de demo de Asterisk
            console.log('⚠️  Usando audio de fallback');
            try {
                await ariManager.playAudio(bridgeId, 'demo-congrats');
            } catch (fallbackError) {
                console.error('❌ Error incluso con fallback:', fallbackError);
            }
        }
    }

    // ==================== ANÁLISIS POST-LLAMADA ====================

    async analyzeAndSaveAppointment(conversationId, callId, contact) {
        console.log('📊 ===== INICIANDO ANÁLISIS POST-LLAMADA =====');
        console.log(`   Call ID: ${callId}`);
        console.log(`   Contacto: ${contact.client_name} (${contact.phone_number})`);

        try {
            const conversationHistory = openaiVoice.getConversationContext(conversationId);
            console.log(`   Mensajes en historial: ${conversationHistory.length}`);

            // SIEMPRE analizar, aunque solo haya 1 mensaje (el saludo)
            if (conversationHistory.length === 0) {
                console.log('⚠️ No hay historial de conversación para analizar');
                openaiVoice.clearConversationContext(conversationId);
                return;
            }

            // Log del historial completo para debugging
            console.log('📝 Historial de conversación:');
            conversationHistory.forEach((msg, i) => {
                console.log(`   [${i}] ${msg.role}: ${msg.content.substring(0, 100)}...`);
            });

            // Ejecutar análisis (ahora con regex + GPT)
            console.log('🔍 Ejecutando análisis de intención...');
            const analysis = await openaiVoice.analyzeConversationIntent(conversationHistory);

            console.log('📊 Resultado del análisis:');
            console.log(`   - Interés: ${analysis.interest} (${analysis.interestLevel})`);
            console.log(`   - Quiere cita: ${analysis.wantsAppointment}`);
            console.log(`   - Acuerdo alcanzado: ${analysis.agreement}`);
            console.log(`   - Fecha detectada: ${analysis.appointmentDate} (raw: ${analysis.rawDateMentioned})`);
            console.log(`   - Hora detectada: ${analysis.appointmentTime} (raw: ${analysis.rawTimeMentioned})`);
            console.log(`   - Respuesta cliente: ${analysis.clientResponse}`);
            console.log(`   - Notas: ${analysis.notes}`);

            // Crear cita si se detectó interés o acuerdo
            const shouldCreateAppointment =
                analysis.wantsAppointment ||
                analysis.agreement ||
                (analysis.interest && analysis.interestLevel === 'high') ||
                (analysis.appointmentDate && analysis.appointmentTime);

            if (shouldCreateAppointment) {
                // Construir datetime si tenemos fecha y hora
                let appointmentDatetime = null;
                if (analysis.appointmentDate && analysis.appointmentTime) {
                    appointmentDatetime = `${analysis.appointmentDate} ${analysis.appointmentTime}:00`;
                }

                const appointmentData = {
                    callId: callId,
                    contactId: contact.id,
                    campaignId: contact.campaign_id,
                    phoneNumber: contact.phone_number,
                    clientName: contact.client_name,
                    date: analysis.appointmentDate,
                    time: analysis.appointmentTime,
                    datetime: appointmentDatetime,
                    notes: `${analysis.notes || ''} | Cliente: ${analysis.clientResponse} | Raw: fecha="${analysis.rawDateMentioned}", hora="${analysis.rawTimeMentioned}"`,
                    interestLevel: analysis.interestLevel || 'medium',
                    agreementReached: analysis.agreement || false
                };

                console.log('📅 CREANDO CITA en base de datos...');
                const appointmentId = await voicebotDB.createAppointment(appointmentData);
                console.log(`✅ CITA CREADA - ID: ${appointmentId}`);
                console.log(`   Para: ${contact.client_name}`);
                console.log(`   Fecha: ${analysis.appointmentDate || 'Por definir'}`);
                console.log(`   Hora: ${analysis.appointmentTime || 'Por definir'}`);

                // Actualizar estadísticas de campaña
                await voicebotDB.updateCampaignStats(contact.campaign_id);
            } else {
                console.log('ℹ️ No se detectó cita para agendar');
                console.log(`   Razón: interest=${analysis.interest}, wantsAppointment=${analysis.wantsAppointment}, agreement=${analysis.agreement}`);
            }

        } catch (error) {
            console.error('❌ ERROR en análisis post-llamada:', error);
            console.error('   Stack:', error.stack);
        } finally {
            // SIEMPRE limpiar contexto al final
            openaiVoice.clearConversationContext(conversationId);
            console.log('📊 ===== FIN ANÁLISIS POST-LLAMADA =====');
        }
    }

    // ==================== PRE-GENERACIÓN DE PITCH ====================

    // Formatea número de precio a texto legible (ej: 3500000 -> "3 millones 500 mil")
    formatPriceToText(price) {
        if (!price && price !== 0) return null;

        const originalPrice = price;
        let numStr = String(price);

        // Log para debug
        console.log(`💰 formatPriceToText input: "${originalPrice}" (tipo: ${typeof price})`);

        // Limpiar: remover todo excepto dígitos y puntos decimales
        // Primero normalizar: si tiene coma como decimal, convertir
        numStr = numStr.replace(/,/g, ''); // Remover comas de miles
        numStr = numStr.replace(/[^\d.]/g, ''); // Solo dígitos y punto

        // Si tiene punto decimal, tomar solo la parte entera
        if (numStr.includes('.')) {
            numStr = numStr.split('.')[0];
        }

        const num = parseInt(numStr, 10);

        console.log(`💰 formatPriceToText parsed: "${numStr}" -> ${num}`);

        if (isNaN(num) || num === 0) {
            console.log(`💰 formatPriceToText: número inválido, retornando null`);
            return null;
        }

        let result = '';

        if (num >= 1000000) {
            const millions = Math.floor(num / 1000000);
            const remainder = num % 1000000;
            const thousands = Math.floor(remainder / 1000);
            const units = remainder % 1000;

            result = `${millions} ${millions === 1 ? 'millón' : 'millones'}`;

            if (thousands > 0) {
                result += ` ${thousands} mil`;
            }

            // Si hay unidades significativas (más de 0), agregar
            if (units > 0 && thousands === 0) {
                result += ` ${units}`;
            }
        } else if (num >= 1000) {
            const thousands = Math.floor(num / 1000);
            const units = num % 1000;

            result = `${thousands} mil`;

            if (units > 0) {
                result += ` ${units}`;
            }
        } else {
            result = String(num);
        }

        console.log(`💰 formatPriceToText result: "${result}"`);
        return result;
    }

    // Formatea tamaño (solo agrega "metros cuadrados" si es número puro)
    formatSizeToText(size) {
        if (!size) return null;

        const sizeStr = String(size).toLowerCase();
        // Si ya tiene "metro" o "m2", no agregar de nuevo
        if (sizeStr.includes('metro') || sizeStr.includes('m2') || sizeStr.includes('m²')) {
            return size;
        }

        // Limpiar y devolver solo el número
        const numStr = sizeStr.replace(/[^\d]/g, '');
        return numStr || null;
    }

    // Construir el texto del pitch de la nave
    buildNavePitch(contact) {
        // Debug: mostrar datos del contacto
        console.log(`🏭 buildNavePitch - Datos del contacto:`);
        console.log(`   nave_type: "${contact.nave_type}"`);
        console.log(`   nave_location: "${contact.nave_location}"`);
        console.log(`   nave_size: "${contact.nave_size}" (tipo: ${typeof contact.nave_size})`);
        console.log(`   nave_price: "${contact.nave_price}" (tipo: ${typeof contact.nave_price})`);

        let pitch = 'Tenemos una nave ';

        // Tipo de nave
        if (contact.nave_type) {
            pitch += `${contact.nave_type} `;
        } else {
            pitch += 'industrial ';
        }

        // Ubicación
        if (contact.nave_location) {
            pitch += `en ${contact.nave_location}, `;
        }

        // Tamaño (formateado)
        const sizeText = this.formatSizeToText(contact.nave_size);
        console.log(`   sizeText formateado: "${sizeText}"`);
        if (sizeText) {
            pitch += `de ${sizeText} metros cuadrados, `;
        }

        // Precio (formateado)
        const priceText = this.formatPriceToText(contact.nave_price);
        console.log(`   priceText formateado: "${priceText}"`);
        if (priceText) {
            pitch += `con precio de ${priceText} de pesos. `;
        }

        // Ventajas
        if (contact.strategic_advantages) {
            pitch += `${contact.strategic_advantages}. `;
        }

        pitch += '¿Te gustaría agendar una visita para conocerla?';

        console.log(`🏭 buildNavePitch - Pitch final: "${pitch}"`);
        return pitch;
    }

    // Pre-generar audio del pitch mientras se reproduce el saludo
    async preGeneratePitchAudio(pitchText, callId) {
        const asteriskSoundsPath = '/usr/share/asterisk/sounds/custom';
        await fs.mkdir(asteriskSoundsPath, { recursive: true });

        const filename = `pitch_${callId}_${Date.now()}`;
        const tempPcmPath = `/tmp/${filename}.pcm`;
        const finalWavPath = `${asteriskSoundsPath}/${filename}.wav`;

        console.log('🎵 Pre-generando audio del pitch...');
        const startTime = Date.now();

        // Generar TTS en PCM (mejor calidad)
        await openaiVoice.textToSpeech(pitchText, tempPcmPath);

        // Convertir PCM 24kHz a WAV 8kHz para Asterisk
        await audioHandler.convertForAsteriskPlaybackDirect(tempPcmPath, finalWavPath);

        console.log(`⚡ Pitch pre-generado en ${Date.now() - startTime}ms`);

        return finalWavPath;
    }

    // ==================== ESTADÍSTICAS ====================

    async getCampaignStats(campaignId) {
        return await voicebotDB.getCampaignStats(campaignId);
    }

    getActiveCampaigns() {
        return Array.from(this.activeCampaigns.values());
    }

    // Resetear contador de llamadas (para cuando queda trabado)
    resetCallsCounter() {
        console.log(`🔄 Reseteando contador de llamadas (estaba en ${this.activeCallsCount})`);
        this.activeCallsCount = 0;
        this.callHandlers.clear();
        return { success: true, message: 'Contador reseteado' };
    }

    getStatus() {
        return {
            activeCallsCount: this.activeCallsCount,
            maxConcurrentCalls: this.maxConcurrentCalls,
            activeCampaigns: this.activeCampaigns.size,
            callHandlers: this.callHandlers.size
        };
    }

    async shutdown() {
        console.log('🛑 Deteniendo Campaign Manager...');

        // Pausar todas las campañas activas
        for (const [campaignId] of this.activeCampaigns) {
            await this.pauseCampaign(campaignId);
        }

        // Desconectar ARI
        ariManager.disconnect();

        console.log('✅ Campaign Manager detenido');
    }
}

module.exports = new CampaignManager();
