const axios = require('axios');
const fs = require('fs').promises;
const FormData = require('form-data');
const path = require('path');
require('dotenv').config();

class OpenAIVoiceService {
    constructor() {
        // OpenAI config
        this.apiKey = process.env.OPENAI_API_KEY;
        this.baseURL = 'https://api.openai.com/v1';
        this.ttsVoice = process.env.OPENAI_TTS_VOICE || 'nova';
        this.whisperLanguage = process.env.OPENAI_WHISPER_LANGUAGE || 'es';
        this.gptModelFast = process.env.OPENAI_GPT_MODEL_FAST || 'gpt-4o-mini';
        this.gptModelAnalysis = process.env.OPENAI_GPT_MODEL_ANALYSIS || 'gpt-4o';
        this.conversationContexts = new Map();

        // Eleven Labs config
        this.elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
        this.elevenLabsVoiceId = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL';
        this.elevenLabsModel = process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2';
        this.elevenLabsStability = parseFloat(process.env.ELEVENLABS_STABILITY || '0.5');
        this.elevenLabsSimilarity = parseFloat(process.env.ELEVENLABS_SIMILARITY || '0.75');
        this.elevenLabsBaseURL = 'https://api.elevenlabs.io/v1';

        // TTS Provider selection
        this.ttsProvider = process.env.TTS_PROVIDER || 'elevenlabs';
        console.log(`🎤 TTS Provider: ${this.ttsProvider.toUpperCase()}`);
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
            // Prompt optimizado para llamadas telefónicas - ignorar ruido de fondo
            formData.append('prompt', 'Llamada telefónica directa. Solo transcribir la voz principal más cercana al micrófono. Ignorar ruidos de fondo, televisión, radio, conversaciones lejanas, música ambiente. El cliente habla directamente al teléfono con frases cortas: sí, no, me interesa, está bien, claro, mañana, el lunes, a las diez, no gracias, después, quién habla, de dónde.');

            const response = await axios.post(
                `${this.baseURL}/audio/transcriptions`,
                formData,
                {
                    headers: {
                        ...formData.getHeaders(),
                        'Authorization': `Bearer ${this.apiKey}`
                    },
                    timeout: 10000 // 10 segundos para Whisper (mejor precisión)
                }
            );

            let transcribedText = response.data.text || '';

            // Filtrar alucinaciones conocidas de Whisper (frases que inventa cuando hay silencio o ruido)
            const hallucinations = [
                // Frases de YouTube/podcasts
                'eso es todo por hoy',
                'nos vemos la próxima semana',
                'nos vemos la proxima semana',
                'un nuevo episodio',
                'gracias por ver',
                'gracias por escuchar',
                'suscríbete',
                'suscribete',
                'dale like',
                'comparte este video',
                'hasta la próxima',
                'hasta la proxima',
                'bendiciones',
                'que dios te bendiga',
                // Subtítulos - MUY COMÚN
                'subtítulos por',
                'subtitulos por',
                'subtítulos realizados',
                'subtitulos realizados',
                'subtítulos en español',
                'subtitulos en espanol',
                'amara.org',
                'amara org',
                'comunidad de amara',
                'realizado por',
                'traducido por',
                'transcrito por',
                // URLs
                'www.',
                'http',
                '.com',
                '.org',
                '.net',
                // Símbolos de música
                '♪',
                '🎵',
                '🎶',
                // Etiquetas
                '[música]',
                '[musica]',
                '[music]',
                '[applause]',
                '[risas]',
                '[laughter]',
                '[ruido]',
                '[noise]',
                '[inaudible]',
                '[silencio]',
                '[silence]',
                '[sonido]',
                '[sound]',
                // Ruido de fondo
                'música de fondo',
                'ruido de fondo',
                'static',
                'estática',
                // Sonidos sin significado
                '...',
                'hmm',
                'mmm',
                'uh',
                'um',
                'eh',
                'ah',
                'oh',
                // Frases de silencio
                'silencio',
                'no hay audio',
                'sin audio',
                'audio no disponible',
                // Frases religiosas random
                'amén',
                'amen',
                'aleluya',
                'gloria a dios'
            ];

            const lowerText = transcribedText.toLowerCase();
            const isHallucination = hallucinations.some(h => lowerText.includes(h));

            if (isHallucination) {
                console.log(`⚠️ Alucinación de Whisper detectada: "${transcribedText}"`);
                transcribedText = ''; // Tratar como silencio
            }

            console.log('✅ Transcripción Whisper:', transcribedText || '(vacío)');

            return {
                text: transcribedText,
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
                    temperature: 0.3, // Más bajo = respuestas más consistentes y predecibles
                    max_tokens: 100, // Respuestas más concisas
                    presence_penalty: 0.6, // Evita repetición
                    frequency_penalty: 0.4 // Menos palabras repetidas
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 8000 // 8 segundos para GPT (balance entre velocidad y completitud)
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

        // Prompt por defecto - TONO CONSULTIVO Y PROFESIONAL
        return `Eres un asesor de inversión industrial de Navetec. Tu objetivo es reactivar leads y agendar visitas a naves industriales.

TONO DE VOZ:
- Profesional, calmado y consultivo (como un asesor, no un vendedor)
- Formal pero amable, transmite seguridad sin sonar robótico
- Humaniza la conversación: "quiero actualizarte", "estoy revisando tu registro"
- Ritmo natural, pausado, no acelerado
- Explica en palabras simples, sin tecnicismos innecesarios

REGLAS DE COMUNICACIÓN:
- Máximo 2 oraciones por respuesta
- Saluda profesionalmente y explica rápido quién llama y por qué
- Haz una pregunta clave para avanzar la conversación
- No insistas demasiado, solo ofrece opciones
- Respeta silencios y pausas del cliente

CUANDO PREGUNTEN QUIÉN HABLA O QUIÉN ERES:
Si el cliente pregunta "quién habla", "de dónde llaman", "quién es", "con quién hablo", "de qué empresa", "qué quieren", etc:
- SIEMPRE responde: "Te habla un asesor de Navetec, una empresa de naves industriales. Te llamo porque tenemos una nave disponible que podría interesarte."
- NO te confundas ni digas que no sabes quién eres
- Si insisten, repite que eres de Navetec y estás para ayudarle

CUANDO PREGUNTEN INFORMACIÓN DE LA NAVE:
Si el cliente pregunta precio, tamaño, ubicación, características, detalles, metros cuadrados, cuánto cuesta, dónde está, etc:
- USA LOS DATOS DE LA NAVE que tienes en el contexto
- Si preguntan el PRECIO: responde el precio exacto de la nave
- Si preguntan el TAMAÑO: responde los metros cuadrados
- Si preguntan la UBICACIÓN: responde dónde está ubicada
- Si preguntan el TIPO: responde qué tipo de nave es
- Si preguntan VENTAJAS: responde las ventajas estratégicas
- Si preguntan INFO ADICIONAL: responde la información extra
- SIEMPRE termina preguntando si le gustaría agendar una visita
- NUNCA digas que no tienes esa información si está en los datos de la nave

CUANDO EL CLIENTE NO ENTIENDE O PIDE QUE REPITAS:
Si el cliente dice cosas como "qué dijiste", "cómo", "no te escuché", "repite", "mande", "perdón", "no entendí":
- REPITE lo último que dijiste, con las MISMAS palabras o muy similares
- NO continues la conversación
- NO digas algo nuevo
- NO cuelgues
- Solo repite la información de forma clara

CUANDO TÚ NO ENTIENDES AL CLIENTE:
- Di: "Disculpa, no te escuché bien, ¿me puedes repetir?"
- NO inventes lo que dijo
- NO asumas nada

CUANDO DES INFORMACIÓN TÉCNICA:
- Sé preciso con datos: precio por m², ubicación, tamaño
- Explica beneficios en términos concretos
- Da contexto a los números, no los sueltes solos
- Presenta comparativas breves solo si son relevantes

FLUJO:
1. Si muestra interés → pregunta qué día le acomoda para una visita
2. Si da el día → pregunta la hora
3. Si da día y hora → confirma: "Perfecto, te agendo el [día] a las [hora]. Te esperamos."
4. Si hace preguntas sobre la nave → responde con los datos y pregunta si quiere agendar
5. Si dice "no me interesa" o "no gracias" CLARAMENTE → "Entendido, gracias por tu tiempo."

IMPORTANTE - CUÁNDO DESPEDIRSE:
- SOLO despídete si el cliente dice CLARAMENTE que NO le interesa (ej: "no me interesa", "no gracias", "no quiero")
- Si el cliente hace preguntas (ubicación, precio, tamaño, etc.) → NO te despidas, responde la pregunta
- Si el cliente dice algo confuso o no entiendes → NO te despidas, pide que repita
- Si el cliente solo dice "no" sin contexto → pregunta "¿No le interesa la información?" antes de despedirte
- NUNCA te despidas después de dar información, siempre pregunta si quiere agendar visita

PROHIBIDO:
- Sonar vendedor o exagerado ("aprovecha YA", "última oportunidad")
- Ser invasivo o presionar
- Usar lenguaje emocional fuera de lugar
- Inventar información
- Soltar números sin contexto
- Colgar o despedirte si el cliente solo pide que repitas
- Continuar con la conversación si el cliente no entendió
- Decir que no sabes quién eres o de dónde llamas
- Decir que no tienes información de la nave cuando SÍ la tienes en el contexto`;
    }

    // ==================== TTS (Text-to-Speech) ====================

    // Método principal que elige el provider
    async textToSpeech(text, outputPath, voice = null) {
        if (this.ttsProvider === 'elevenlabs') {
            return this.textToSpeechElevenLabs(text, outputPath, voice);
        } else {
            return this.textToSpeechOpenAI(text, outputPath, voice);
        }
    }

    // ==================== ELEVEN LABS TTS ====================

    async textToSpeechElevenLabs(text, outputPath, voiceId = null) {
        try {
            const normalizedText = this.normalizeTextForTTS(text);
            const voice = voiceId || this.elevenLabsVoiceId;

            console.log(`🎵 Generando TTS con Eleven Labs, voz: ${voice}, modelo: ${this.elevenLabsModel}`);

            // Usar PCM 24kHz para compatibilidad con el flujo existente (igual que OpenAI)
            const response = await axios.post(
                `${this.elevenLabsBaseURL}/text-to-speech/${voice}?output_format=pcm_24000`,
                {
                    text: normalizedText,
                    model_id: this.elevenLabsModel,
                    voice_settings: {
                        stability: this.elevenLabsStability,
                        similarity_boost: this.elevenLabsSimilarity,
                        style: 0.0,
                        use_speaker_boost: true
                    }
                },
                {
                    headers: {
                        'xi-api-key': this.elevenLabsApiKey,
                        'Content-Type': 'application/json'
                    },
                    responseType: 'arraybuffer',
                    timeout: 15000
                }
            );

            // Guardar PCM en el path exacto que se solicita
            const pcmPath = outputPath.replace(/\.(wav|mp3)$/, '.pcm');
            await fs.writeFile(pcmPath, response.data);

            console.log(`✅ TTS Eleven Labs generado (PCM 24kHz): ${pcmPath} (${response.data.length} bytes)`);

            return {
                success: true,
                path: pcmPath,
                size: response.data.length,
                format: 'pcm'
            };
        } catch (error) {
            console.error('❌ Error en Eleven Labs TTS:', error.response?.data || error.message);

            // Fallback a OpenAI si Eleven Labs falla
            if (this.apiKey) {
                console.log('⚠️ Intentando fallback a OpenAI TTS...');
                return this.textToSpeechOpenAI(text, outputPath);
            }

            throw new Error(`Error generando audio con Eleven Labs: ${error.message}`);
        }
    }

    // ==================== OPENAI TTS ====================

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

    async textToSpeechOpenAI(text, outputPath, voice = null) {
        try {
            // Normalizar texto para mejor pronunciación
            const normalizedText = this.normalizeTextForTTS(text);

            // tts-1-hd: mejor calidad de audio, más natural para llamadas de venta
            // Velocidad 0.9 - más pausado y natural para mejor comprensión
            const ttsModel = process.env.OPENAI_TTS_MODEL || 'tts-1-hd';
            const ttsSpeed = parseFloat(process.env.OPENAI_TTS_SPEED || '0.9');

            console.log(`🎵 Generando TTS con modelo ${ttsModel}, voz ${voice || this.ttsVoice}, velocidad ${ttsSpeed}x`);

            const response = await axios.post(
                `${this.baseURL}/audio/speech`,
                {
                    model: ttsModel,
                    input: normalizedText,
                    voice: voice || this.ttsVoice,
                    response_format: 'pcm', // PCM 24kHz 16-bit mono - sin compresión = mejor calidad
                    speed: ttsSpeed
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    responseType: 'arraybuffer',
                    timeout: 15000 // 15 segundos para TTS-HD (mayor calidad requiere más tiempo)
                }
            );

            // Guardar audio PCM (raw 24kHz 16-bit mono)
            const pcmPath = outputPath.replace(/\.(mp3|wav)$/, '.pcm');
            await fs.writeFile(pcmPath, response.data);

            console.log(`✅ TTS generado (PCM): ${pcmPath}`);

            return {
                success: true,
                path: pcmPath,
                size: response.data.length,
                format: 'pcm' // Indicar que es PCM para la conversión
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

            // 3. Convertir respuesta a audio (TTS - OpenAI o Eleven Labs)
            console.log('🔊 Convirtiendo respuesta a audio...');
            const ttsResult = await this.textToSpeech(response.text, audioOutputPath);

            const processingTime = Date.now() - startTime;

            return {
                success: true,
                transcription: transcription.text,
                response: response.text,
                audioPath: ttsResult.path, // Usar el path correcto (mp3 o pcm)
                audioFormat: ttsResult.format,
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
  "interestLevel": "high/none",
  "wantsAppointment": true/false,
  "appointmentDate": "YYYY-MM-DD o null",
  "appointmentTime": "HH:MM o null",
  "rawDateMentioned": "texto original de fecha mencionada o null",
  "rawTimeMentioned": "texto original de hora mencionada o null",
  "clientResponse": "positivo/negativo",
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
            interestLevel: (hasPositiveResponse && !hasRejection) ? 'high' : 'none',
            wantsAppointment: hasPositiveResponse && (dayMatch !== null || timeMatch !== null),
            appointmentDate: dayMatch ? this.parseRelativeDate(dayMatch[0]) : null,
            appointmentTime: timeMatch ? this.parseRelativeTime(timeMatch[0]) : null,
            rawDateMentioned: dayMatch ? dayMatch[0] : null,
            rawTimeMentioned: timeMatch ? timeMatch[0] : null,
            clientResponse: hasPositiveResponse ? 'positivo' : 'negativo',
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
