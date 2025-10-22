const axios = require('axios');
const config = require('../config/config');
const csvService = require('./csvService');

class AIService {
    constructor() {
        this.apiKey = config.deepseekApiKey;
        this.apiUrl = config.deepseekApiUrl;
    }

    async generateResponse(messages) {
        try {
            // Incluir datos de CSV en el prompt del sistema
            const enrichedMessages = await this.addCSVDataToSystemPrompt(messages);

            const response = await axios.post(this.apiUrl, {
                model: 'deepseek-chat',
                messages: enrichedMessages,
                max_tokens: 1000,
                temperature: 0.5
            }, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                }
            });

            return response.data.choices[0].message.content;
        } catch (error) {
            console.error('Error con DeepSeek API:', error.response?.data || error.message);

            if (error.response?.data?.error?.type === 'authentication_error') {
                throw new Error('Error de autenticación con API key');
            }

            throw new Error('Error generando respuesta de IA');
        }
    }

    async analyzeConversationStatus(messages, lastMessage) {
        try {
            const analysisPrompt = {
                role: 'system',
                content: `Analiza esta conversación y determina si se cumple alguna de estas condiciones:

1. ACEPTADO: El cliente mostró intención clara de proceder
   - Ejemplos: "quiero agendar", "sí me interesa", "manda la información", "proporciono mi correo", "vamos con eso"

2. RECHAZADO: El cliente rechazó explícitamente la oferta
   - Ejemplos: "no me interesa", "no gracias", "no es para mí", "no quiero", "gracias pero no", "ya no me interesa"

3. FRUSTRADO: El cliente pide explícitamente que dejen de contactarlo o muestra enojo claro
   - Ejemplos: "ya no me contacten", "dejen de escribirme", "no quiero más mensajes", "están molestando", "ya es mucho"
   - IMPORTANTE: Solo usa FRUSTRADO si hay lenguaje EXPLÍCITO de molestia. No lo uses solo porque dijo "no".

4. ACTIVO: La conversación sigue activa y productiva
   - Ejemplos: hace preguntas, pide más información, muestra interés genuino, responde constructivamente

5. INACTIVO: El cliente dejó de responder sin señales claras

REGLAS CRÍTICAS:
- Si dice "no" una sola vez SIN pedir que dejen de contactarlo = RECHAZADO (NO FRUSTRADO)
- Si dice "no me interesa" o "no gracias" = RECHAZADO (NO FRUSTRADO)
- Si dice "ya no quiero saber más" o "no me contacten más" = FRUSTRADO
- Si proporciona datos de contacto o confirma cita = ACEPTADO
- Si hace preguntas o muestra curiosidad = ACTIVO

Responde ÚNICAMENTE con una de estas palabras: ACEPTADO, RECHAZADO, FRUSTRADO, ACTIVO, o INACTIVO`
            };

            const userPrompt = {
                role: 'user',
                content: `Último mensaje del cliente: "${lastMessage}"\n\nAnaliza el estado de la conversación.`
            };

            const aiMessages = [analysisPrompt, ...messages, userPrompt];
            const response = await this.generateResponse(aiMessages);

            return response.trim().toUpperCase();
        } catch (error) {
            console.error('Error analizando estado de conversación:', error);
            return 'ACTIVO'; // Default a activo en caso de error
        }
    }

    async addCSVDataToSystemPrompt(messages) {
        try {
            // Obtener todos los datos de CSV
            const allRecords = await csvService.getAllRecords();
            
            if (allRecords.length === 0) {
                return messages;
            }
            
            // Formatear todos los registros
            const csvData = allRecords.map(record => 
                csvService.formatRecordForDisplay(record)
            ).join('\n\n---\n\n');
            
            // Agregar CSV data al mensaje del sistema
            const enrichedMessages = [...messages];
            const systemMessage = enrichedMessages.find(m => m.role === 'system');
            
            if (systemMessage) {
                systemMessage.content = systemMessage.content + `\n\n*BASE DE DATOS DE NAVES DISPONIBLES:*\n\n${csvData}\n\nUsa esta información cuando el usuario pregunte sobre naves, parques industriales, precios, disponibilidad o cualquier tema relacionado. Si el usuario pregunta por algo específico que está en esta base de datos, úsala para responder de manera precisa y actualizada.`;
            }
            
            return enrichedMessages;
        } catch (error) {
            console.error('Error agregando datos CSV al prompt:', error);
            return messages;
        }
    }
}

module.exports = new AIService();