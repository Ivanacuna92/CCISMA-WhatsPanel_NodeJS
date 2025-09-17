const axios = require('axios');
const config = require('../config/config');
const database = require('./database');
const fs = require('fs');
const path = require('path');

class ConversationAnalyzer {
    constructor() {
        this.apiKey = config.deepseekApiKey;
        this.apiUrl = config.deepseekApiUrl;
        this.advisorsProfiles = null;
        this.loadAdvisorsProfiles();
    }

    loadAdvisorsProfiles() {
        try {
            const profilesPath = path.join(__dirname, '../../data/advisors-profiles.json');
            const data = fs.readFileSync(profilesPath, 'utf8');
            this.advisorsProfiles = JSON.parse(data).perfiles_de_asesores;
            console.log(`[ConversationAnalyzer] Cargados ${this.advisorsProfiles.length} perfiles de asesores`);
        } catch (error) {
            console.error('[ConversationAnalyzer] Error cargando perfiles de asesores:', error);
            this.advisorsProfiles = [];
        }
    }

    findBestAdvisor(conversationText) {
        if (!this.advisorsProfiles || this.advisorsProfiles.length === 0) {
            this.loadAdvisorsProfiles();
        }

        const text = conversationText.toLowerCase();
        let bestAdvisor = null;
        let highestScore = 0;

        for (const advisor of this.advisorsProfiles) {
            let score = 0;

            // Revisar palabras clave
            if (advisor.palabras_clave) {
                for (const keyword of advisor.palabras_clave) {
                    if (text.includes(keyword.toLowerCase())) {
                        score += 2;
                    }
                }
            }

            // Revisar especialidades (mayor peso)
            for (const specialty of advisor.especialidades) {
                const specialtyWords = specialty.toLowerCase().split(' ');
                for (const word of specialtyWords) {
                    if (word.length > 3 && text.includes(word)) {
                        score += 3;
                    }
                }
            }

            if (score > highestScore) {
                highestScore = score;
                bestAdvisor = advisor;
            }
        }

        // Si no hay match claro, asignar Percy Babb (asesor general)
        if (!bestAdvisor || highestScore < 3) {
            bestAdvisor = this.advisorsProfiles.find(a => a.id === 'asesor_001') || this.advisorsProfiles[0];
        }

        console.log(`[ConversationAnalyzer] Asesor seleccionado: ${bestAdvisor.nombre} (puntaje: ${highestScore})`);
        return bestAdvisor;
    }

    async analyzeConversation(messages, userId = null) {
        try {
            // Preparar el contexto de la conversación
            const conversationText = messages.map(msg => {
                const type = msg.type === 'USER' ? 'Cliente' :
                           msg.type === 'BOT' ? 'Asistente' :
                           msg.type === 'HUMAN' ? 'Soporte' : 'Sistema';
                return `${type}: ${msg.message}`;
            }).join('\n');

            // Encontrar el mejor asesor para esta conversación
            const assignedAdvisor = this.findBestAdvisor(conversationText);

            const analysisPrompt = `Analiza la siguiente conversación y determina:
1. ¿Es una POSIBLE VENTA? (el cliente muestra interés en comprar o solicita precios/información de productos)
2. ¿Es una VENTA CERRADA? (el cliente confirmó compra o llegó a un acuerdo)
3. ¿Se AGENDÓ UNA CITA? (se acordó una reunión, visita o llamada futura)
4. SENTIMIENTO general del cliente (positivo, neutral, negativo)
5. INTENCIÓN principal (información, compra, soporte, queja)

Conversación:
${conversationText}

Responde ÚNICAMENTE con un JSON en este formato exacto:
{
  "posibleVenta": true o false,
  "ventaCerrada": true o false,
  "citaAgendada": true o false,
  "sentiment": "positivo/neutral/negativo",
  "intent": "información/compra/soporte/queja/otro",
  "main_topics": ["tema1", "tema2"],
  "satisfaction_score": 7.5,
  "keywords": ["palabra1", "palabra2"]
}`;

            const response = await axios.post(this.apiUrl, {
                model: 'deepseek-chat',
                messages: [
                    {
                        role: 'system',
                        content: 'Eres un analizador experto de conversaciones de servicio al cliente. Siempre respondes con JSON válido.'
                    },
                    {
                        role: 'user',
                        content: analysisPrompt
                    }
                ],
                temperature: 0.3,
                max_tokens: 400
            }, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                }
            });

            const aiResponse = response.data.choices[0].message.content;
            
            // Intentar parsear la respuesta JSON
            try {
                // Limpiar la respuesta de posibles caracteres extra
                const cleanResponse = aiResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
                const analysis = JSON.parse(cleanResponse);
                
                const result = {
                    posibleVenta: analysis.posibleVenta === true || analysis.posibleVenta === 'true',
                    ventaCerrada: analysis.ventaCerrada === true || analysis.ventaCerrada === 'true',
                    citaAgendada: analysis.citaAgendada === true || analysis.citaAgendada === 'true',
                    sentiment: analysis.sentiment || 'neutral',
                    intent: analysis.intent || 'otro',
                    main_topics: Array.isArray(analysis.main_topics) ? analysis.main_topics : [],
                    issues_detected: Array.isArray(analysis.issues_detected) ? analysis.issues_detected : [],
                    recommendations: Array.isArray(analysis.recommendations) ? analysis.recommendations : [],
                    satisfaction_score: parseFloat(analysis.satisfaction_score) || 5.0,
                    keywords: Array.isArray(analysis.keywords) ? analysis.keywords : [],
                    asesor_asignado: {
                        id: assignedAdvisor.id,
                        nombre: assignedAdvisor.nombre,
                        especialidades: assignedAdvisor.especialidades
                    }
                };

                // Guardar análisis en base de datos
                if (userId) {
                    await this.saveAnalysis(userId, result);
                }

                return result;
            } catch (parseError) {
                console.error('Error parseando respuesta de IA:', parseError);
                console.error('Respuesta recibida:', aiResponse);
                
                // Análisis básico de fallback basado en palabras clave
                return await this.basicAnalysis(conversationText, userId);
            }
        } catch (error) {
            console.error('Error analizando conversación con IA:', error);
            // Análisis básico de fallback
            return await this.basicAnalysis(messages, userId);
        }
    }

    // Análisis básico basado en palabras clave (fallback)
    async basicAnalysis(input, userId = null) {
        let text = '';

        if (typeof input === 'string') {
            text = input.toLowerCase();
        } else if (Array.isArray(input)) {
            text = input.map(msg => msg.message || '').join(' ').toLowerCase();
        }

        // Encontrar el mejor asesor para este texto
        const assignedAdvisor = this.findBestAdvisor(text);

        // Palabras clave para análisis
        const positiveWords = ['gracias', 'excelente', 'perfecto', 'bueno', 'satisfecho', 'contento'];
        const negativeWords = ['malo', 'terrible', 'problema', 'error', 'molesto', 'insatisfecho'];
        const buyingWords = ['comprar', 'precio', 'costo', 'cuánto', 'pagar', 'tarifa', 'presupuesto', 'cotización', 'nave', 'renta', 'venta'];
        const supportWords = ['ayuda', 'problema', 'error', 'falla', 'soporte', 'asistencia'];
        const complaintWords = ['queja', 'reclamo', 'malo', 'terrible', 'molesto'];
        const appointmentWords = ['cita', 'reunión', 'agendar', 'visita', 'llamada', 'ver', 'conocer'];

        // Determinar sentimiento
        let sentiment = 'neutral';
        if (positiveWords.some(word => text.includes(word))) {
            sentiment = 'positivo';
        } else if (negativeWords.some(word => text.includes(word))) {
            sentiment = 'negativo';
        }

        // Determinar intención
        let intent = 'información';
        if (buyingWords.some(word => text.includes(word))) {
            intent = 'compra';
        } else if (supportWords.some(word => text.includes(word))) {
            intent = 'soporte';
        } else if (complaintWords.some(word => text.includes(word))) {
            intent = 'queja';
        }

        // Detectar posible venta, venta cerrada y cita agendada
        const posibleVenta = buyingWords.some(word => text.includes(word));
        const ventaCerrada = text.includes('compro') || text.includes('acepto') || text.includes('quiero') && buyingWords.some(word => text.includes(word));
        const citaAgendada = appointmentWords.some(word => text.includes(word));

        // Calcular puntuación de satisfacción básica
        let score = 5.0;
        if (sentiment === 'positivo') score = 8.0;
        if (sentiment === 'negativo') score = 2.0;

        const result = {
            posibleVenta,
            ventaCerrada,
            citaAgendada,
            sentiment,
            intent,
            main_topics: ['análisis_básico'],
            issues_detected: sentiment === 'negativo' ? ['insatisfacción_detectada'] : [],
            recommendations: ['mejorar_análisis_con_ia'],
            satisfaction_score: score,
            keywords: text.split(' ').slice(0, 5),
            asesor_asignado: {
                id: assignedAdvisor.id,
                nombre: assignedAdvisor.nombre,
                especialidades: assignedAdvisor.especialidades
            }
        };

        // Guardar análisis en base de datos
        if (userId) {
            await this.saveAnalysis(userId, result);
        }

        return result;
    }

    async saveAnalysis(userId, analysis) {
        try {
            const today = new Date().toISOString().split('T')[0];
            
            // Verificar si ya existe análisis para este usuario en esta fecha
            const existing = await database.findOne(
                'conversation_analysis', 
                'user_id = ? AND conversation_date = ?', 
                [userId, today]
            );

            if (existing) {
                // Actualizar análisis existente
                await database.update('conversation_analysis',
                    {
                        sentiment: analysis.sentiment,
                        main_topics: JSON.stringify(analysis.main_topics),
                        intent: analysis.intent,
                        satisfaction_score: analysis.satisfaction_score,
                        keywords: JSON.stringify(analysis.keywords),
                        issues_detected: JSON.stringify(analysis.issues_detected),
                        recommendations: JSON.stringify(analysis.recommendations)
                    },
                    'user_id = ? AND conversation_date = ?',
                    [userId, today]
                );
            } else {
                // Crear nuevo análisis
                await database.insert('conversation_analysis', {
                    user_id: userId,
                    conversation_date: today,
                    sentiment: analysis.sentiment,
                    main_topics: JSON.stringify(analysis.main_topics),
                    intent: analysis.intent,
                    satisfaction_score: analysis.satisfaction_score,
                    keywords: JSON.stringify(analysis.keywords),
                    issues_detected: JSON.stringify(analysis.issues_detected),
                    recommendations: JSON.stringify(analysis.recommendations)
                });
            }
        } catch (error) {
            console.error('Error guardando análisis en BD:', error);
        }
    }

    async getAnalysis(userId, date = null) {
        try {
            const targetDate = date || new Date().toISOString().split('T')[0];
            const analysis = await database.findOne(
                'conversation_analysis', 
                'user_id = ? AND conversation_date = ?', 
                [userId, targetDate]
            );

            if (analysis) {
                return {
                    sentiment: analysis.sentiment,
                    intent: analysis.intent,
                    main_topics: JSON.parse(analysis.main_topics || '[]'),
                    issues_detected: JSON.parse(analysis.issues_detected || '[]'),
                    recommendations: JSON.parse(analysis.recommendations || '[]'),
                    satisfaction_score: analysis.satisfaction_score,
                    keywords: JSON.parse(analysis.keywords || '[]'),
                    created_at: analysis.created_at
                };
            }
            return null;
        } catch (error) {
            console.error('Error obteniendo análisis:', error);
            return null;
        }
    }

    async getAnalysisReport(startDate = null, endDate = null) {
        try {
            let query = `
                SELECT 
                    sentiment,
                    intent,
                    AVG(satisfaction_score) as avg_satisfaction,
                    COUNT(*) as total_conversations,
                    conversation_date
                FROM conversation_analysis
            `;
            let params = [];

            if (startDate && endDate) {
                query += ' WHERE conversation_date BETWEEN ? AND ?';
                params.push(startDate, endDate);
            } else if (startDate) {
                query += ' WHERE conversation_date >= ?';
                params.push(startDate);
            }

            query += ' GROUP BY sentiment, intent, conversation_date ORDER BY conversation_date DESC';

            const results = await database.query(query, params);
            return results;
        } catch (error) {
            console.error('Error obteniendo reporte de análisis:', error);
            return [];
        }
    }

    async getMostCommonIssues(limit = 10) {
        try {
            const analyses = await database.findAll('conversation_analysis', '1=1', [], 'created_at DESC');
            const allIssues = [];

            analyses.forEach(analysis => {
                try {
                    const issues = JSON.parse(analysis.issues_detected || '[]');
                    allIssues.push(...issues);
                } catch (error) {
                    // Ignorar errores de parsing
                }
            });

            // Contar ocurrencias
            const issueCount = {};
            allIssues.forEach(issue => {
                issueCount[issue] = (issueCount[issue] || 0) + 1;
            });

            // Ordenar por frecuencia
            return Object.entries(issueCount)
                .sort(([,a], [,b]) => b - a)
                .slice(0, limit)
                .map(([issue, count]) => ({ issue, count }));
        } catch (error) {
            console.error('Error obteniendo problemas comunes:', error);
            return [];
        }
    }

    // Analizar múltiples conversaciones en batch
    async analyzeMultipleConversations(conversationsList) {
        const results = [];
        
        for (const conversation of conversationsList) {
            const analysis = await this.analyzeConversation(conversation.messages, conversation.userId);
            results.push({
                ...conversation,
                analysis
            });
            
            // Pequeña pausa para no sobrecargar la API
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        return results;
    }

    // Limpiar análisis antiguos (más de 90 días)
    async cleanupOldAnalysis() {
        try {
            await database.query(
                'DELETE FROM conversation_analysis WHERE conversation_date < DATE_SUB(NOW(), INTERVAL 90 DAY)'
            );
            console.log('Análisis antiguos limpiados');
        } catch (error) {
            console.error('Error limpiando análisis antiguos:', error);
        }
    }
}

module.exports = new ConversationAnalyzer();