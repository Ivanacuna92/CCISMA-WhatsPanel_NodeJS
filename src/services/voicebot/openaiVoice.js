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
        // Modelo rápido para conversación, modelo preciso para análisis
        this.gptModelFast = process.env.OPENAI_GPT_MODEL_FAST || 'gpt-4o-mini';
        this.gptModelAnalysis = process.env.OPENAI_GPT_MODEL_ANALYSIS || 'gpt-4o';
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
            // Prompt optimizado para llamadas telefónicas de ventas
            formData.append('prompt', 'Llamada telefónica de ventas de naves industriales. El cliente responde con frases cortas como: sí, no, me interesa, está bien, claro, mañana, el lunes, a las diez, no gracias, después.');

            const response = await axios.post(
                `${this.baseURL}/audio/transcriptions`,
                formData,
                {
                    headers: {
                        ...formData.getHeaders(),
                        'Authorization': `Bearer ${this.apiKey}`
                    },
                    timeout: 10000 // 10 segundos máximo para Whisper
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
                    model: this.gptModelFast, // Modelo rápido para conversación
                    messages: messages,
                    temperature: 0.7,
                    max_tokens: 80, // Respuestas MUY cortas para menor latencia
                    presence_penalty: 0.3 // Evita repetición = respuestas más directas
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 8000 // 8 segundos máximo para GPT
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
        let contextString = '\n\n=== DATOS DE LA NAVE QUE DEBES MENCIONAR ===\n';

        if (context.clientName) {
            contextString += `Cliente: ${context.clientName}\n`;
        }
        if (context.naveType) {
            contextString += `Tipo de nave: ${context.naveType}\n`;
        }
        if (context.naveLocation) {
            contextString += `Ubicación: ${context.naveLocation}\n`;
        }
        if (context.naveSize) {
            contextString += `Tamaño: ${context.naveSize} metros cuadrados\n`;
        }
        if (context.navePrice) {
            contextString += `Precio de venta: ${context.navePrice} pesos mexicanos\n`;
        }
        if (context.extraInfo) {
            contextString += `Info adicional: ${context.extraInfo}\n`;
        }
        if (context.strategicAdvantages) {
            contextString += `Ventajas: ${context.strategicAdvantages}\n`;
        }

        contextString += '\n¡¡¡DEBES MENCIONAR TODOS ESTOS DATOS EN TU PRIMERA RESPUESTA!!!';

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
        return `Eres un vendedor telefónico de Navetec. Vendes naves industriales (NO rentas, solo VENTA).

EL SALUDO YA SE HIZO. El cliente ya escuchó: "¿Tienes un momento para que te cuente?"

AHORA TU PRIMERA RESPUESTA cuando el cliente diga "sí", "claro", "dime", "ok", "por favor", etc:
OBLIGATORIO decir TODA esta información de la nave:
1. Tipo de nave
2. Ubicación
3. Tamaño en metros cuadrados
4. Precio en pesos mexicanos
5. Ventajas (si hay)
Y terminar con: "¿Te gustaría agendar una visita para conocerla?"

EJEMPLO DE TU PRIMERA RESPUESTA:
"Tenemos una bodega industrial en Querétaro, de 500 metros cuadrados, con precio de venta de 2 millones de pesos mexicanos. Está cerca de la autopista. ¿Te gustaría agendar una visita para conocerla?"

DESPUÉS de dar la info, si dice que SÍ quiere visita:
→ Pregunta: "¿Qué día y hora te quedaría bien?"

Cuando te dé día y hora:
→ Confirma: "Perfecto, te agendo para el [día] a las [hora]."

REGLAS:
- NUNCA preguntes por día/hora ANTES de dar la información de la nave
- Di "metros cuadrados" completo
- Di "pesos mexicanos" completo
- Si dice NO: "Entendido, gracias por tu tiempo."
- SÉ BREVE. Máximo 2 oraciones por respuesta después de dar la info inicial.
- NO repitas información que ya dijiste.

IMPORTANTE: Tu PRIMERA respuesta SIEMPRE debe incluir TODA la información de la nave.`;
    }

    // ==================== TTS (Text-to-Speech) ====================

    // Normalizar texto para que el TTS pronuncie correctamente
    normalizeTextForTTS(text) {
        let normalized = text;

        // Metros cuadrados - varias formas
        normalized = normalized.replace(/(\d+)\s*m²/gi, '$1 metros cuadrados');
        normalized = normalized.replace(/(\d+)\s*m2\b/gi, '$1 metros cuadrados');
        normalized = normalized.replace(/(\d+)\s*mts²/gi, '$1 metros cuadrados');
        normalized = normalized.replace(/(\d+)\s*mts2\b/gi, '$1 metros cuadrados');
        normalized = normalized.replace(/(\d+)\s*metros\s*2\b/gi, '$1 metros cuadrados');

        // Pesos mexicanos - varias formas
        normalized = normalized.replace(/\$\s*(\d[\d,\.]*)\s*(MXN|pesos)?/gi, '$1 pesos mexicanos');
        normalized = normalized.replace(/(\d[\d,\.]*)\s*MXN/gi, '$1 pesos mexicanos');
        normalized = normalized.replace(/(\d[\d,\.]*)\s*pesos\s*mx/gi, '$1 pesos mexicanos');

        // Números con comas (formato mexicano) - convertir a palabras para mejor pronunciación
        normalized = normalized.replace(/(\d{1,3}),(\d{3}),(\d{3})/g, '$1 millones $2 mil $3');
        normalized = normalized.replace(/(\d{1,3}),(\d{3})/g, '$1 mil $2');

        // Abreviaciones comunes
        normalized = normalized.replace(/\bm³\b/gi, 'metros cúbicos');
        normalized = normalized.replace(/\bm3\b/gi, 'metros cúbicos');
        normalized = normalized.replace(/\bkm\b/gi, 'kilómetros');
        normalized = normalized.replace(/\bha\b/gi, 'hectáreas');
        normalized = normalized.replace(/\bUSD\b/gi, 'dólares');

        console.log('📝 Texto normalizado para TTS:', normalized);
        return normalized;
    }

    async textToSpeech(text, outputPath, voice = null) {
        try {
            // Normalizar texto para mejor pronunciación
            const normalizedText = this.normalizeTextForTTS(text);

            // tts-1: rápido (~200ms), tts-1-hd: mejor calidad pero ~500ms más lento
            // Velocidad 0.95 es un buen balance - claro pero no lento
            const ttsModel = process.env.OPENAI_TTS_MODEL || 'tts-1';
            const ttsSpeed = parseFloat(process.env.OPENAI_TTS_SPEED || '0.95');

            console.log(`🎵 Generando TTS con modelo ${ttsModel}, voz ${voice || this.ttsVoice}, velocidad ${ttsSpeed}x`);

            const response = await axios.post(
                `${this.baseURL}/audio/speech`,
                {
                    model: ttsModel, // tts-1-hd para mejor calidad
                    input: normalizedText,
                    voice: voice || this.ttsVoice,
                    response_format: 'mp3', // MP3 alta calidad
                    speed: ttsSpeed
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    responseType: 'arraybuffer',
                    timeout: 10000 // 10 segundos máximo para TTS
                }
            );

            // Guardar audio MP3
            const mp3Path = outputPath.endsWith('.mp3') ? outputPath : outputPath.replace('.wav', '.mp3');
            await fs.writeFile(mp3Path, response.data);

            console.log(`✅ TTS generado: ${mp3Path}`);

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
            const today = new Date();
            const todayStr = today.toISOString().split('T')[0];
            const dayOfWeek = today.getDay(); // 0=domingo, 1=lunes, etc.

            // Primero hacer análisis con regex como respaldo
            const regexAnalysis = this.analyzeWithRegex(conversationHistory);
            console.log('📊 Análisis regex previo:', regexAnalysis);

            const analysisPrompt = `Analiza esta conversación de ventas telefónicas y extrae información sobre citas agendadas.

FECHA DE HOY: ${todayStr} (${['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'][dayOfWeek]})

CONVERSACIÓN COMPLETA:
${conversationHistory.map(msg => `${msg.role === 'user' ? 'CLIENTE' : 'BOT'}: ${msg.content}`).join('\n')}

CRITERIOS PARA DETECTAR CITA AGENDADA:
- El cliente mostró interés positivo ("sí", "me interesa", "claro", "ok", "está bien", "va", "dale", "perfecto", "de acuerdo")
- Se mencionó un día específico ("mañana", "lunes", "martes", "el viernes", "3 de enero", etc.)
- Se mencionó una hora ("10", "a las 3", "en la mañana", "por la tarde", "2:30", etc.)
- El bot confirmó la cita ("te agendo", "te espero", "quedamos", "confirmado", "listo")

CONVERSIÓN DE FECHAS RELATIVAS (basándote en HOY ${todayStr}):
- "mañana" = día siguiente
- "pasado mañana" = +2 días
- "lunes/martes/etc" = próximo día de esa semana
- "la próxima semana" = +7 días

CONVERSIÓN DE HORAS:
- "mañana" (como hora) = 10:00
- "medio día" = 12:00
- "tarde" = 15:00
- "noche" = 19:00
- "10 de la mañana" = 10:00
- "3 de la tarde" / "3 pm" = 15:00

IMPORTANTE: Si hay CUALQUIER indicio de que se acordó una cita, marca agreement=true y wantsAppointment=true.

Responde ÚNICAMENTE con este JSON (sin explicaciones):
{
  "interest": true/false,
  "agreement": true/false,
  "interestLevel": "high/medium/low/none",
  "wantsAppointment": true/false,
  "appointmentDate": "YYYY-MM-DD o null",
  "appointmentTime": "HH:MM o null",
  "rawDateMentioned": "texto original de fecha mencionada o null",
  "rawTimeMentioned": "texto original de hora mencionada o null",
  "clientResponse": "positivo/negativo/indeciso/no_contesto",
  "notes": "resumen breve de lo acordado o razón de no agendar"
}`;

            const response = await axios.post(
                `${this.baseURL}/chat/completions`,
                {
                    model: this.gptModelAnalysis, // Modelo preciso para análisis de citas
                    messages: [
                        { role: 'system', content: 'Eres un analizador experto de conversaciones de ventas telefónicas. Tu trabajo es detectar si se agendó una cita. Sé generoso en la detección - si hay indicios de interés y fechas/horas mencionadas, considera que hay cita. Responde SOLO en JSON válido.' },
                        { role: 'user', content: analysisPrompt }
                    ],
                    temperature: 0.2,
                    response_format: { type: 'json_object' }
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            const gptAnalysis = JSON.parse(response.data.choices[0].message.content);
            console.log('📊 Análisis GPT:', gptAnalysis);

            // Combinar análisis: si regex detectó cita pero GPT no, confiar en regex
            const finalAnalysis = this.mergeAnalysis(regexAnalysis, gptAnalysis);
            console.log('📊 Análisis FINAL combinado:', finalAnalysis);

            return finalAnalysis;
        } catch (error) {
            console.error('❌ Error analizando conversación con GPT:', error);
            // En caso de error, usar solo análisis regex
            const regexOnly = this.analyzeWithRegex(conversationHistory);
            console.log('⚠️ Usando solo análisis regex por error GPT:', regexOnly);
            return regexOnly;
        }
    }

    // Análisis con expresiones regulares como respaldo
    analyzeWithRegex(conversationHistory) {
        const fullText = conversationHistory.map(m => m.content.toLowerCase()).join(' ');
        const clientMessages = conversationHistory.filter(m => m.role === 'user').map(m => m.content.toLowerCase()).join(' ');
        const botMessages = conversationHistory.filter(m => m.role === 'assistant').map(m => m.content.toLowerCase()).join(' ');

        // Detectar respuestas positivas del cliente
        const positivePatterns = /\b(sí|si|claro|ok|está bien|esta bien|me interesa|interesa|va|dale|perfecto|de acuerdo|por supuesto|adelante|bueno|sale)\b/i;
        const hasPositiveResponse = positivePatterns.test(clientMessages);

        // Detectar confirmación del bot
        const confirmPatterns = /(te agendo|te espero|quedamos|confirmado|listo|te esperamos|nos vemos|perfecto.*entonces)/i;
        const botConfirmed = confirmPatterns.test(botMessages);

        // Detectar menciones de día
        const dayPatterns = /\b(mañana|pasado mañana|lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo|próximo|proximo|siguiente|(\d{1,2})\s*(de\s*)?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre))\b/i;
        const dayMatch = fullText.match(dayPatterns);

        // Detectar menciones de hora
        const timePatterns = /\b((\d{1,2})(:(\d{2}))?\s*(am|pm|de la mañana|de la tarde|de la noche|hrs|horas)?|mañana|medio\s*día|mediodia|tarde|noche|en la mañana|por la mañana|en la tarde|por la tarde)\b/i;
        const timeMatch = fullText.match(timePatterns);

        // Detectar rechazo explícito
        const rejectPatterns = /\b(no me interesa|no gracias|no puedo|no tengo tiempo|otro momento|después|despues|no estoy interesado|no quiero|cuelgo)\b/i;
        const hasRejection = rejectPatterns.test(clientMessages);

        const result = {
            interest: hasPositiveResponse && !hasRejection,
            agreement: (hasPositiveResponse && botConfirmed) || (dayMatch && timeMatch && hasPositiveResponse),
            interestLevel: hasRejection ? 'none' : (hasPositiveResponse ? 'high' : 'low'),
            wantsAppointment: hasPositiveResponse && (dayMatch !== null || timeMatch !== null),
            appointmentDate: dayMatch ? this.parseRelativeDate(dayMatch[0]) : null,
            appointmentTime: timeMatch ? this.parseRelativeTime(timeMatch[0]) : null,
            rawDateMentioned: dayMatch ? dayMatch[0] : null,
            rawTimeMentioned: timeMatch ? timeMatch[0] : null,
            clientResponse: hasRejection ? 'negativo' : (hasPositiveResponse ? 'positivo' : 'indeciso'),
            notes: `Regex: positivo=${hasPositiveResponse}, confirmado=${botConfirmed}, día=${dayMatch?.[0]}, hora=${timeMatch?.[0]}`
        };

        return result;
    }

    // Combinar análisis de regex y GPT
    mergeAnalysis(regexAnalysis, gptAnalysis) {
        // Si ambos detectan cita, usar GPT (más preciso en fechas)
        // Si solo regex detecta, usar regex
        // Si solo GPT detecta, usar GPT

        const merged = { ...gptAnalysis };

        // Si regex detectó cita pero GPT no, confiar en regex
        if (regexAnalysis.wantsAppointment && !gptAnalysis.wantsAppointment) {
            console.log('⚠️ Regex detectó cita que GPT no vio, usando regex');
            merged.wantsAppointment = true;
            merged.agreement = regexAnalysis.agreement;
            merged.interest = true;
        }

        // Si regex tiene fecha/hora y GPT no, usar los de regex
        if (regexAnalysis.appointmentDate && !gptAnalysis.appointmentDate) {
            merged.appointmentDate = regexAnalysis.appointmentDate;
            merged.rawDateMentioned = regexAnalysis.rawDateMentioned;
        }
        if (regexAnalysis.appointmentTime && !gptAnalysis.appointmentTime) {
            merged.appointmentTime = regexAnalysis.appointmentTime;
            merged.rawTimeMentioned = regexAnalysis.rawTimeMentioned;
        }

        // Asegurar que si hay fecha y hora, se marque como cita
        if (merged.appointmentDate && merged.appointmentTime && merged.interest) {
            merged.wantsAppointment = true;
            merged.agreement = true;
        }

        return merged;
    }

    // Convertir fecha relativa a YYYY-MM-DD
    parseRelativeDate(dateStr) {
        const today = new Date();
        const lower = dateStr.toLowerCase();

        if (lower.includes('mañana') && !lower.includes('pasado')) {
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            return tomorrow.toISOString().split('T')[0];
        }

        if (lower.includes('pasado mañana')) {
            const dayAfter = new Date(today);
            dayAfter.setDate(dayAfter.getDate() + 2);
            return dayAfter.toISOString().split('T')[0];
        }

        const days = ['domingo', 'lunes', 'martes', 'miércoles', 'miercoles', 'jueves', 'viernes', 'sábado', 'sabado'];
        for (let i = 0; i < days.length; i++) {
            if (lower.includes(days[i])) {
                const targetDay = i <= 6 ? i : i - 1; // Ajustar para miercoles/sabado sin acento
                const currentDay = today.getDay();
                let daysUntil = targetDay - currentDay;
                if (daysUntil <= 0) daysUntil += 7;
                const targetDate = new Date(today);
                targetDate.setDate(targetDate.getDate() + daysUntil);
                return targetDate.toISOString().split('T')[0];
            }
        }

        // Intentar parsear fecha específica (ej: "3 de enero")
        const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
        const dateMatch = lower.match(/(\d{1,2})\s*(de\s*)?(\w+)/);
        if (dateMatch) {
            const day = parseInt(dateMatch[1]);
            const monthStr = dateMatch[3];
            const monthIndex = months.findIndex(m => monthStr.includes(m));
            if (monthIndex !== -1) {
                const year = monthIndex < today.getMonth() ? today.getFullYear() + 1 : today.getFullYear();
                return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            }
        }

        return null;
    }

    // Convertir hora relativa a HH:MM
    parseRelativeTime(timeStr) {
        const lower = timeStr.toLowerCase();

        // Hora específica
        const hourMatch = lower.match(/(\d{1,2})(:(\d{2}))?/);
        if (hourMatch) {
            let hour = parseInt(hourMatch[1]);
            const minutes = hourMatch[3] ? hourMatch[3] : '00';

            // Ajustar AM/PM
            if (lower.includes('pm') || lower.includes('tarde') || lower.includes('noche')) {
                if (hour < 12) hour += 12;
            } else if (lower.includes('am') || lower.includes('mañana')) {
                if (hour === 12) hour = 0;
            } else if (hour < 8) {
                // Si es menor a 8 sin especificar, probablemente es PM
                hour += 12;
            }

            return `${String(hour).padStart(2, '0')}:${minutes}`;
        }

        // Horas genéricas
        if (lower.includes('mañana') && !lower.includes('pasado')) return '10:00';
        if (lower.includes('medio') && lower.includes('día')) return '12:00';
        if (lower.includes('mediodia')) return '12:00';
        if (lower.includes('tarde')) return '15:00';
        if (lower.includes('noche')) return '19:00';

        return null;
    }

    // Agregar mensaje al historial (para el saludo inicial)
    addToConversationHistory(conversationId, role, content) {
        let history = this.conversationContexts.get(conversationId) || [];
        history.push({ role, content });
        this.conversationContexts.set(conversationId, history);
        console.log(`📝 Agregado al historial [${role}]: ${content.substring(0, 50)}...`);
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
