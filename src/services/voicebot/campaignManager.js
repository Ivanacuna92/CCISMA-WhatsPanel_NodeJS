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
    }

    async initialize() {
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

        // Limpiar grabaciones antiguas cada hora
        setInterval(() => {
            audioHandler.cleanupOldRecordings();
        }, 60 * 60 * 1000);

        console.log('✅ Campaign Manager inicializado con ARI');
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
                await voicebotDB.addContact(campaignId, {
                    phone: this.cleanPhoneNumber(record.Teléfono || record.Telefono || record.Phone),
                    name: record.Nombre || record.Name || 'Cliente',
                    naveType: record['Tipo de Nave'] || record['Tipo'] || '',
                    location: record.Ubicación || record.Ubicacion || record.Location || '',
                    size: record['Tamaño (m2)'] || record.Tamaño || record.Size || '',
                    price: record.Precio || record.Price || '',
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

        // Verificar límite de llamadas concurrentes
        if (this.activeCallsCount >= this.maxConcurrentCalls) {
            console.log(`⏳ Límite de llamadas concurrentes alcanzado (${this.maxConcurrentCalls})`);
            setTimeout(() => this.processCallQueue(campaignId), 5000);
            return;
        }

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

            // Guardar handler para esta llamada (usando phoneNumber como key)
            this.callHandlers.set(contact.phone_number, {
                contact: contact,
                startTime: new Date()
            });

            return result;
        } catch (error) {
            console.error(`❌ Error haciendo llamada a ${contact.phone_number}:`, error);

            this.activeCallsCount--;
            await voicebotDB.updateContactStatus(contact.id, 'failed');

            throw error;
        }
    }

    // ==================== MANEJO DE LLAMADAS ARI ====================

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
                await ariManager.hangup(channelId);
                return;
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

            // Limpiar handler
            this.callHandlers.delete(phoneNumber);

        } catch (error) {
            console.error('❌ Error manejando llamada contestada:', error);
            this.activeCallsCount--;
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

        try {
            // ===== SALUDO INICIAL =====
            const greeting = `Hola ${contact.client_name || 'buenos días'}, soy el asistente virtual de Navetec. Te llamo para presentarte una nave industrial que tenemos disponible en ${contact.nave_location || 'tu zona'}. ¿Tienes un momento para que te cuente?`;

            await this.speakToClient(bridgeId, greeting, callId, turnCount++, 'bot', conversationId);

            // ===== CICLO DE CONVERSACIÓN =====
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

                // SOLUCIÓN: Grabar DESDE EL BRIDGE con dirección mixmon
                // Esto captura solo el audio entrante del cliente
                const recordedPath = await ariManager.recordAudioFromBridge(
                    bridgeId,
                    audioPath,
                    5  // maxDuration reducido a 5s para respuestas rápidas
                );

                if (!recordedPath) {
                    console.log('⚠️  No se pudo grabar audio del cliente');
                    break;
                }

                // Verificar si hay voz en el audio
                const hasVoice = await audioHandler.hasVoiceActivity(recordedPath);

                if (!hasVoice) {
                    console.log('🔇 Silencio detectado, el cliente no respondió');
                    // Despedida por silencio
                    await this.speakToClient(
                        bridgeId,
                        'Parece que no puedes hablar en este momento. Te llamaremos en otro momento. Que tengas buen día.',
                        callId,
                        turnCount++,
                        'bot',
                        conversationId
                    );
                    break;
                }

                // ===== TRANSCRIBIR AUDIO CON WHISPER (DIRECTO, SIN MEJORAR) =====
                // Saltar mejoras de audio para reducir latencia
                console.log('🎤 Transcribiendo audio del cliente con Whisper...');

                const processStartTime = Date.now();

                let transcription;
                try {
                    // Transcribir DIRECTO sin procesar para velocidad
                    transcription = await openaiVoice.transcribeAudio(recordedPath);
                } catch (error) {
                    console.error('❌ Error transcribiendo:', error);
                    // Pedir que repita
                    await this.speakToClient(
                        bridgeId,
                        'Perdona, no te escuché bien. ¿Podrías repetir por favor?',
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
                        'No logré entender tu respuesta. ¿Podrías hablar más cerca del teléfono?',
                        callId,
                        turnCount++,
                        'bot',
                        conversationId
                    );
                    continue;
                }

                console.log(`📝 Cliente dijo: "${transcription.text}"`);

                // Guardar transcripción del cliente
                await voicebotDB.addTranscription(callId, {
                    sequence: turnCount,
                    speaker: 'client',
                    audioPath: recordedPath,
                    text: transcription.text,
                    confidence: 0.95,
                    processingTime: Date.now() - processStartTime
                });

                // ===== GENERAR RESPUESTA CON GPT =====
                console.log('🤖 Generando respuesta con GPT...');

                let aiResponse;
                try {
                    aiResponse = await openaiVoice.generateResponse(
                        transcription.text,
                        conversationId,
                        null,
                        context
                    );
                } catch (error) {
                    console.error('❌ Error generando respuesta:', error);
                    await this.speakToClient(
                        bridgeId,
                        'Disculpa, tuve un problema técnico. Permíteme continuar.',
                        callId,
                        turnCount++,
                        'bot',
                        conversationId
                    );
                    continue;
                }

                console.log(`💬 Bot responderá: "${aiResponse.text}"`);

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

            // ===== ANÁLISIS POST-CONVERSACIÓN =====
            console.log('📊 Analizando conversación...');

            const conversationHistory = openaiVoice.getConversationContext(conversationId);

            if (conversationHistory.length > 2) { // Al menos 1 intercambio real
                try {
                    const analysis = await openaiVoice.analyzeConversationIntent(conversationHistory);

                    // Si hubo acuerdo o solicitud de cita, crear appointment
                    if (analysis.wantsAppointment || analysis.agreement) {
                        await voicebotDB.createAppointment({
                            callId: callId,
                            contactId: contact.id,
                            campaignId: contact.campaign_id,
                            phoneNumber: contact.phone_number,
                            clientName: contact.client_name,
                            date: analysis.appointmentDate,
                            time: analysis.appointmentTime,
                            notes: analysis.notes,
                            interestLevel: analysis.interestLevel,
                            agreementReached: analysis.agreement
                        });

                        console.log('📅 Cita agendada para', contact.client_name);
                    }
                } catch (error) {
                    console.error('Error analizando conversación:', error);
                }
            }

            // Limpiar contexto
            openaiVoice.clearConversationContext(conversationId);

            console.log(`✅ Conversación finalizada con ${contact.client_name || contact.phone_number}`);

        } catch (error) {
            console.error('❌ Error en conversación:', error);
            openaiVoice.clearConversationContext(conversationId);
            throw error;
        }
    }

    async speakToClient(bridgeId, text, callId, sequence, speaker, conversationId, responseText = null) {
        console.log(`🔊 Bot: ${text}`);

        const startTime = Date.now();

        try {
            // ===== GENERAR AUDIO CON TTS =====
            const audioOutputPath = audioHandler.generateAudioPath(callId, sequence, 'output');

            console.log('🎵 Generando audio con OpenAI TTS...');

            const ttsResult = await openaiVoice.textToSpeech(text, audioOutputPath);

            // Convertir audio para Asterisk (usar el path del MP3)
            const asteriskAudioPath = await audioHandler.convertForAsteriskPlayback(ttsResult.path);

            // Copiar a directorio de Asterisk sounds (usar data directory, no varlib)
            const asteriskSoundsPath = '/usr/share/asterisk/sounds/custom';
            await fs.mkdir(asteriskSoundsPath, { recursive: true });

            const filename = path.basename(asteriskAudioPath, '.gsm');
            const destPath = path.join(asteriskSoundsPath, `${filename}.gsm`);
            await fs.copyFile(asteriskAudioPath, destPath);

            // ===== REPRODUCIR AUDIO AL CLIENTE VIA ARI =====
            const soundPath = `custom/${filename}`;
            await ariManager.playAudio(bridgeId, soundPath);

            // ===== GUARDAR TRANSCRIPCIÓN =====
            await voicebotDB.addTranscription(callId, {
                sequence: sequence,
                speaker: speaker,
                audioPath: audioOutputPath,
                text: text,
                response: responseText,
                confidence: 1.0,
                processingTime: Date.now() - startTime
            });

            console.log(`✅ Bot habló y se guardó transcripción`);

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

    // ==================== ESTADÍSTICAS ====================

    async getCampaignStats(campaignId) {
        return await voicebotDB.getCampaignStats(campaignId);
    }

    getActiveCampaigns() {
        return Array.from(this.activeCampaigns.values());
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
