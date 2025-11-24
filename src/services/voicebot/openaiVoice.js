const axios = require('axios');
const fs = require('fs').promises;
const FormData = require('form-data');
const path = require('path');
require('dotenv').config();

class OpenAIVoiceService {
    constructor() {
        this.apiKey = process.env.OPENAI_API_KEY;
        this.baseURL = 'https://api.openai.com/v1';
        this.ttsVoice = process.env.OPENAI_TTS_VOICE || 'nova';
        this.whisperLanguage = process.env.OPENAI_WHISPER_LANGUAGE || 'es';
        this.gptModel = process.env.OPENAI_GPT_MODEL || 'gpt-4o';
        this.conversationContexts = new Map();
    }

    // ==================== WHISPER (Speech-to-Text) ====================

    async transcribeAudio(audioFilePath, language = null) {
        try {
            const formData = new FormData();
            const audioBuffer = await fs.readFile(audioFilePath);

            formData.append('file', audioBuffer, {
                filename: path.basename(audioFilePath),
                contentType: 'audio/wav'
            });
            formData.append('model', 'whisper-1');
            formData.append('language', language || this.whisperLanguage);
            // Prompt simple para contexto sin confundir a Whisper
            formData.append('prompt', 'Conversación de ventas en español. Respuestas cortas del cliente.');

            const response = await axios.post(
                `${this.baseURL}/audio/transcriptions`,
                formData,
                {
                    headers: {
                        ...formData.getHeaders(),
                        'Authorization': `Bearer ${this.apiKey}`
                    }
                }
            );

            console.log('✅ Transcripción Whisper:', response.data.text);

            return {
                text: response.data.text,
                language: response.data.language,
                duration: response.data.duration
            };
        } catch (error) {
            console.error('❌ Error en Whisper:', error.response?.data || error.message);
            throw new Error(`Error transcribiendo audio: ${error.message}`);
        }
    }

    // ==================== GPT (Text Generation) ====================

    async generateResponse(userMessage, conversationId, systemPrompt = null, context = null) {
        try {
            // Obtener o crear contexto de conversación
            let conversationHistory = this.conversationContexts.get(conversationId) || [];

            // Si hay contexto adicional (datos del cliente), agregarlo al system prompt
            let finalSystemPrompt = systemPrompt || await this.getDefaultSystemPrompt();

            if (context) {
                finalSystemPrompt += this.formatContextData(context);
            }

            // Construir mensajes
            const messages = [
                { role: 'system', content: finalSystemPrompt },
                ...conversationHistory,
                { role: 'user', content: userMessage }
            ];

            const response = await axios.post(
                `${this.baseURL}/chat/completions`,
                {
                    model: this.gptModel,
                    messages: messages,
                    temperature: parseFloat(process.env.OPENAI_GPT_TEMPERATURE || '0.7'),
                    max_tokens: 150 // Aumentado para respuestas naturales
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            const assistantMessage = response.data.choices[0].message.content;

            // Actualizar historial de conversación
            conversationHistory.push({ role: 'user', content: userMessage });
            conversationHistory.push({ role: 'assistant', content: assistantMessage });

            // Limitar historial a últimos 10 mensajes
            if (conversationHistory.length > 10) {
                conversationHistory = conversationHistory.slice(-10);
            }

            this.conversationContexts.set(conversationId, conversationHistory);

            console.log('✅ Respuesta GPT:', assistantMessage);

            return {
                text: assistantMessage,
                tokensUsed: response.data.usage.total_tokens
            };
        } catch (error) {
            console.error('❌ Error en GPT:', error.response?.data || error.message);
            throw new Error(`Error generando respuesta: ${error.message}`);
        }
    }

    formatContextData(context) {
        let contextString = '\n\n=== INFORMACIÓN DEL CLIENTE ===\n';

        if (context.clientName) {
            contextString += `Nombre: ${context.clientName}\n`;
        }
        if (context.naveType) {
            contextString += `Tipo de nave: ${context.naveType}\n`;
        }
        if (context.naveLocation) {
            contextString += `Ubicación: ${context.naveLocation}\n`;
        }
        if (context.naveSize) {
            contextString += `Tamaño: ${context.naveSize} m²\n`;
        }
        if (context.navePrice) {
            contextString += `Precio: $${context.navePrice}\n`;
        }
        if (context.extraInfo) {
            contextString += `Información adicional: ${context.extraInfo}\n`;
        }
        if (context.strategicAdvantages) {
            contextString += `Ventajas estratégicas: ${context.strategicAdvantages}\n`;
        }

        contextString += '\nUSA ESTA INFORMACIÓN para responder al cliente de manera personalizada.';

        return contextString;
    }

    async getDefaultSystemPrompt() {
        // Intentar cargar desde base de datos
        try {
            const voicebotDB = require('./voicebotDatabase');
            const prompt = await voicebotDB.getConfig('system_prompt');
            if (prompt) return prompt;
        } catch (error) {
            console.log('No se pudo cargar prompt de BD, usando default');
        }

        // Prompt por defecto
        return `Eres un asistente de ventas telefónico profesional para Navetec, empresa de naves industriales.

Tu objetivo es presentar la nave industrial disponible y agendar citas.

Características de tu conversación:
- Sé amable y profesional
- Responde de forma clara y concisa (2-3 oraciones máximo)
- Adapta tu tono al cliente
- Si el cliente muestra interés, ofrece agendar una cita
- Si el cliente no entiende o pide que repitas, simplifica tu respuesta

Recuerda:
- Eres un bot, pero conversacional
- Usa lenguaje natural
- No des información que no tengas en el contexto
- Si el cliente dice algo confuso o incoherente, pide amablemente que repita`;
    }

    // ==================== TTS (Text-to-Speech) ====================

    async textToSpeech(text, outputPath, voice = null) {
        try {
            // Usar MP3 en lugar de WAV porque OpenAI genera WAV con headers corruptos
            const response = await axios.post(
                `${this.baseURL}/audio/speech`,
                {
                    model: 'tts-1', // tts-1 es más rápido que tts-1-hd
                    input: text,
                    voice: voice || this.ttsVoice,
                    response_format: 'mp3',
                    speed: parseFloat(process.env.OPENAI_TTS_SPEED || '1.1') // Aumentado a 1.1x para hablar más rápido
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    responseType: 'arraybuffer'
                }
            );

            // Guardar audio MP3 temporalmente
            const mp3Path = outputPath.replace('.wav', '.mp3');
            await fs.writeFile(mp3Path, response.data);

            console.log('✅ Audio TTS generado (MP3):', mp3Path);

            return {
                success: true,
                path: mp3Path,
                size: response.data.length
            };
        } catch (error) {
            console.error('❌ Error en TTS:', error.response?.data || error.message);
            throw new Error(`Error generando audio: ${error.message}`);
        }
    }

    // ==================== FLUJO COMPLETO ====================

    async processVoiceInput(audioInputPath, audioOutputPath, conversationId, context = null) {
        const startTime = Date.now();

        try {
            // 1. Transcribir audio del cliente (Whisper)
            console.log('🎤 Transcribiendo audio del cliente...');
            const transcription = await this.transcribeAudio(audioInputPath);

            if (!transcription.text || transcription.text.trim() === '') {
                console.log('⚠️  Audio vacío o inaudible');
                return {
                    success: false,
                    error: 'No se detectó voz en el audio'
                };
            }

            // 2. Generar respuesta con GPT
            console.log('🤖 Generando respuesta con GPT...');
            const response = await this.generateResponse(
                transcription.text,
                conversationId,
                null,
                context
            );

            // 3. Convertir respuesta a audio (TTS)
            console.log('🔊 Convirtiendo respuesta a audio...');
            await this.textToSpeech(response.text, audioOutputPath);

            const processingTime = Date.now() - startTime;

            return {
                success: true,
                transcription: transcription.text,
                response: response.text,
                audioPath: audioOutputPath,
                processingTime: processingTime,
                tokensUsed: response.tokensUsed
            };
        } catch (error) {
            console.error('❌ Error procesando voz:', error);
            return {
                success: false,
                error: error.message,
                processingTime: Date.now() - startTime
            };
        }
    }

    // ==================== ANÁLISIS DE INTENCIÓN ====================

    async analyzeConversationIntent(conversationHistory) {
        try {
            const analysisPrompt = `Analiza la siguiente conversación y determina:
1. ¿El cliente mostró interés en la nave industrial? (sí/no)
2. ¿Se llegó a un acuerdo o se agendó algo? (sí/no)
3. Nivel de interés (alto/medio/bajo)
4. ¿El cliente quiere una cita? (sí/no)
5. Fecha/hora mencionada (si hay)

Conversación:
${conversationHistory.map(msg => `${msg.role}: ${msg.content}`).join('\n')}

Responde SOLO en formato JSON:
{
  "interest": true/false,
  "agreement": true/false,
  "interestLevel": "high/medium/low",
  "wantsAppointment": true/false,
  "appointmentDate": "YYYY-MM-DD o null",
  "appointmentTime": "HH:MM o null",
  "notes": "resumen breve"
}`;

            const response = await axios.post(
                `${this.baseURL}/chat/completions`,
                {
                    model: 'gpt-4o',
                    messages: [
                        { role: 'system', content: 'Eres un analizador de conversaciones de ventas. Responde SOLO en JSON válido.' },
                        { role: 'user', content: analysisPrompt }
                    ],
                    temperature: 0.3,
                    response_format: { type: 'json_object' }
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            const analysis = JSON.parse(response.data.choices[0].message.content);
            console.log('📊 Análisis de conversación:', analysis);

            return analysis;
        } catch (error) {
            console.error('❌ Error analizando conversación:', error);
            return {
                interest: false,
                agreement: false,
                interestLevel: 'low',
                wantsAppointment: false,
                appointmentDate: null,
                appointmentTime: null,
                notes: 'Error en análisis'
            };
        }
    }

    clearConversationContext(conversationId) {
        this.conversationContexts.delete(conversationId);
        console.log(`🗑️  Contexto de conversación ${conversationId} eliminado`);
    }

    getConversationContext(conversationId) {
        return this.conversationContexts.get(conversationId) || [];
    }
}

module.exports = new OpenAIVoiceService();
