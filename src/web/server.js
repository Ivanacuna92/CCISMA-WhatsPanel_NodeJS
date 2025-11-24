const express = require('express');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const logger = require('../services/logger');
const humanModeManager = require('../services/humanModeManager');
const salesManager = require('../services/salesManager');
const conversationAnalyzer = require('../services/conversationAnalyzer');
const authService = require('../services/authService');
const csvService = require('../services/csvService');
const userDataManager = require('../services/userDataManager');
const { requireAuth, requireAdmin, requireSupportOrAdmin } = require('../middleware/auth');
const ViteExpress = require('vite-express');

class WebServer {
    constructor(port = 3000) {
        this.app = express();
        this.port = port;
        this.setupMiddleware();
        this.setupRoutes();
    }

    setupMiddleware() {
        this.app.use(cors({
            origin: true,
            credentials: true
        }));
        this.app.use(express.json());
        this.app.use(cookieParser());
        
        // En producción, servir archivos estáticos de React build
        if (process.env.NODE_ENV === 'production') {
            this.app.use(express.static(path.join(__dirname, '../../dist')));
        }
    }

    setupRoutes() {
        // ===== RUTAS PÚBLICAS DE AUTENTICACIÓN =====
        
        // Endpoint para obtener código QR de WhatsApp
        this.app.get('/api/qr', (req, res) => {
            try {
                const bot = global.whatsappBot;
                if (!bot || !bot.currentQR) {
                    return res.json({ 
                        qr: null, 
                        message: 'No hay código QR disponible. El bot puede estar ya conectado o reiniciándose.' 
                    });
                }
                
                res.json({ 
                    qr: bot.currentQR,
                    message: 'Escanea este código con WhatsApp'
                });
            } catch (error) {
                console.error('Error obteniendo QR:', error);
                res.status(500).json({ error: 'Error obteniendo código QR' });
            }
        });
        
        // Endpoint para cerrar sesión y generar nuevo QR
        this.app.post('/api/logout', async (req, res) => {
            try {
                const bot = global.whatsappBot;
                if (!bot) {
                    return res.status(400).json({ 
                        success: false,
                        message: 'Bot no está inicializado' 
                    });
                }
                
                const result = await bot.logout();
                
                if (result) {
                    res.json({ 
                        success: true,
                        message: 'Sesión cerrada. Nuevo QR disponible en 2 segundos.' 
                    });
                } else {
                    res.status(500).json({ 
                        success: false,
                        message: 'Error al cerrar sesión' 
                    });
                }
            } catch (error) {
                console.error('Error en logout:', error);
                res.status(500).json({ 
                    success: false,
                    error: 'Error al procesar logout' 
                });
            }
        });
        
        // Página HTML para mostrar el QR
        this.app.get('/qr', (req, res) => {
            res.send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>WhatsApp QR - Navetec</title>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <style>
                        * {
                            margin: 0;
                            padding: 0;
                            box-sizing: border-box;
                        }
                        
                        body {
                            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                            min-height: 100vh;
                            background-color: #f9fafb;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            padding: 1rem;
                        }
                        
                        .container {
                            background: white;
                            padding: 3rem 2rem;
                            border-radius: 0.5rem;
                            box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06);
                            text-align: center;
                            max-width: 28rem;
                            width: 100%;
                        }
                        
                        .header {
                            margin-bottom: 2rem;
                        }
                        
                        h1 { 
                            color: #00567D;
                            font-size: 1.875rem;
                            font-weight: 800;
                            margin-bottom: 0.5rem;
                        }
                        
                        .subtitle {
                            color: #6b7280;
                            font-size: 0.875rem;
                        }
                        
                        .qr-container {
                            background: #f9fafb;
                            border-radius: 0.5rem;
                            padding: 1.5rem;
                            margin: 1.5rem 0;
                            min-height: 300px;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                        }
                        
                        #qrcode {
                            display: inline-block;
                        }
                        
                        #qrcode canvas {
                            border-radius: 0.375rem;
                        }
                        
                        #status {
                            padding: 0.75rem 1rem;
                            border-radius: 0.375rem;
                            font-size: 0.875rem;
                            margin: 1rem 0;
                            font-weight: 500;
                        }
                        
                        .success {
                            background-color: #dcfce7;
                            color: #166534;
                            border: 1px solid #86efac;
                        }
                        
                        .waiting {
                            background-color: #fef3c7;
                            color: #92400e;
                            border: 1px solid #fcd34d;
                        }
                        
                        .error {
                            background-color: #fee2e2;
                            color: #991b1b;
                            border: 1px solid #fca5a5;
                        }
                        
                        .btn-reset {
                            width: 100%;
                            padding: 0.5rem 1rem;
                            background-color: #00567D;
                            color: white;
                            border: none;
                            border-radius: 0.375rem;
                            font-size: 0.875rem;
                            font-weight: 500;
                            cursor: pointer;
                            transition: background-color 0.2s;
                            display: inline-flex;
                            align-items: center;
                            justify-content: center;
                            gap: 0.5rem;
                        }
                        
                        .btn-reset:hover:not(:disabled) {
                            background-color: #002B53;
                        }
                        
                        .btn-reset:disabled {
                            opacity: 0.5;
                            cursor: not-allowed;
                        }
                        
                        .spinner {
                            display: inline-block;
                            width: 1rem;
                            height: 1rem;
                            border: 2px solid transparent;
                            border-top-color: currentColor;
                            border-radius: 50%;
                            animation: spin 0.6s linear infinite;
                        }
                        
                        @keyframes spin {
                            to { transform: rotate(360deg); }
                        }
                        
                        .info-text {
                            margin-top: 1.5rem;
                            padding-top: 1.5rem;
                            border-top: 1px solid #e5e7eb;
                            font-size: 0.75rem;
                            color: #6b7280;
                            line-height: 1.5;
                        }
                        
                        .loading-placeholder {
                            width: 256px;
                            height: 256px;
                            background: linear-gradient(90deg, #f3f4f6 25%, #e5e7eb 50%, #f3f4f6 75%);
                            background-size: 200% 100%;
                            animation: loading 1.5s infinite;
                            border-radius: 0.375rem;
                        }
                        
                        @keyframes loading {
                            0% { background-position: 200% 0; }
                            100% { background-position: -200% 0; }
                        }
                    </style>
                    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
                </head>
                <body>
                    <div class="container">
                        <div class="header">
                            <h1>Navetec WhatsApp</h1>
                            <p class="subtitle">Escanea el código QR para conectar</p>
                        </div>
                        
                        <div class="qr-container">
                            <div id="qrcode">
                                <div class="loading-placeholder"></div>
                            </div>
                        </div>
                        
                        <div id="status" class="waiting">Cargando código QR...</div>
                        
                        <button onclick="resetSession()" class="btn-reset" id="resetBtn">
                            <span id="resetBtnText">Reiniciar Sesión</span>
                        </button>
                        
                        <div class="info-text">
                            <strong>Instrucciones:</strong><br>
                            1. Abre WhatsApp en tu teléfono<br>
                            2. Ve a Configuración → Dispositivos vinculados<br>
                            3. Toca "Vincular dispositivo"<br>
                            4. Escanea este código QR
                        </div>
                    </div>
                    
                    <script>
                        let qrcode = null;
                        let isResetting = false;
                        
                        async function resetSession() {
                            if (isResetting) return;
                            
                            if (confirm('¿Estás seguro de que quieres reiniciar la sesión de WhatsApp?')) {
                                isResetting = true;
                                const btn = document.getElementById('resetBtn');
                                const btnText = document.getElementById('resetBtnText');
                                
                                try {
                                    btn.disabled = true;
                                    btnText.innerHTML = '<span class="spinner"></span> Reiniciando...';
                                    
                                    const response = await fetch('/api/logout', { method: 'POST' });
                                    const data = await response.json();
                                    
                                    const statusEl = document.getElementById('status');
                                    if (data.success) {
                                        statusEl.textContent = 'Reiniciando sesión... Espera el nuevo QR';
                                        statusEl.className = 'waiting';
                                        // Esperar 3 segundos antes de verificar el nuevo QR
                                        setTimeout(checkQR, 3000);
                                    } else {
                                        statusEl.textContent = 'Error: ' + data.message;
                                        statusEl.className = 'error';
                                    }
                                } catch (error) {
                                    document.getElementById('status').textContent = 'Error: ' + error.message;
                                    document.getElementById('status').className = 'error';
                                } finally {
                                    btn.disabled = false;
                                    btnText.textContent = 'Reiniciar Sesión';
                                    isResetting = false;
                                }
                            }
                        }
                        
                        async function checkQR() {
                            try {
                                const response = await fetch('/api/qr');
                                const data = await response.json();
                                
                                const statusEl = document.getElementById('status');
                                const qrEl = document.getElementById('qrcode');
                                
                                if (data.qr) {
                                    statusEl.textContent = 'Escanea el código con WhatsApp';
                                    statusEl.className = 'waiting';
                                    
                                    // Limpiar placeholder si existe
                                    const placeholder = qrEl.querySelector('.loading-placeholder');
                                    if (placeholder) {
                                        placeholder.remove();
                                    }
                                    
                                    if (qrcode) {
                                        qrcode.clear();
                                        qrcode.makeCode(data.qr);
                                    } else {
                                        qrEl.innerHTML = '';
                                        qrcode = new QRCode(qrEl, {
                                            text: data.qr,
                                            width: 256,
                                            height: 256,
                                            colorDark: "#000000",
                                            colorLight: "#ffffff",
                                            correctLevel: QRCode.CorrectLevel.M
                                        });
                                    }
                                } else {
                                    if (qrcode) {
                                        qrcode.clear();
                                        qrcode = null;
                                    }
                                    qrEl.innerHTML = '<div style="padding: 2rem; color: #10b981;">✓ Conectado exitosamente</div>';
                                    statusEl.textContent = data.message || 'Bot conectado exitosamente';
                                    statusEl.className = 'success';
                                }
                            } catch (error) {
                                document.getElementById('status').textContent = 'Error de conexión: ' + error.message;
                                document.getElementById('status').className = 'error';
                            }
                        }
                        
                        // Verificar cada 3 segundos
                        checkQR();
                        setInterval(checkQR, 3000);
                    </script>
                </body>
                </html>
            `);
        });
        
        // Login
        this.app.post('/api/auth/login', async (req, res) => {
            try {
                const { email, password } = req.body;
                
                if (!email || !password) {
                    return res.status(400).json({ 
                        error: 'Email y contraseña son requeridos' 
                    });
                }

                const loginResult = await authService.login(email, password);
                
                // Establecer cookie httpOnly
                res.cookie('auth_token', loginResult.token, {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: 'lax',
                    expires: loginResult.expiresAt
                });

                res.json({
                    success: true,
                    user: loginResult.user,
                    expiresAt: loginResult.expiresAt
                });
            } catch (error) {
                res.status(401).json({ 
                    error: 'Error de autenticación', 
                    message: error.message 
                });
            }
        });

        // Logout
        this.app.post('/api/auth/logout', async (req, res) => {
            try {
                const token = req.cookies?.auth_token;
                if (token) {
                    await authService.logout(token);
                }
                
                res.clearCookie('auth_token');
                res.json({ success: true });
            } catch (error) {
                console.error('Error en logout:', error);
                res.status(500).json({ error: 'Error cerrando sesión' });
            }
        });

        // Verificar sesión actual
        this.app.get('/api/auth/me', requireAuth, (req, res) => {
            res.json({
                user: req.user,
                expiresAt: req.sessionExpiresAt
            });
        });

        // ===== TODAS LAS DEMÁS RUTAS REQUIEREN AUTENTICACIÓN =====
        this.app.use('/api', requireAuth);

        // API endpoint para obtener logs
        this.app.get('/api/logs/:date?', async (req, res) => {
            try {
                const date = req.params.date || null;
                const logs = await logger.getLogs(date);
                res.json(Array.isArray(logs) ? logs : []);
            } catch (error) {
                console.error('Error obteniendo logs:', error);
                res.status(500).json([]);
            }
        });

        // API endpoint para obtener fechas disponibles
        this.app.get('/api/dates', async (req, res) => {
            try {
                const dates = await logger.getAvailableDates();
                res.json(Array.isArray(dates) ? dates : []);
            } catch (error) {
                console.error('Error obteniendo fechas:', error);
                res.status(500).json([]);
            }
        });

        // API endpoint para estadísticas
        this.app.get('/api/stats/:date?', async (req, res) => {
            try {
                const date = req.params.date || null;
                const logs = await logger.getLogs(date);
                
                const stats = this.calculateStats(logs);
                res.json(stats);
            } catch (error) {
                console.error('Error obteniendo estadísticas:', error);
                res.status(500).json({ error: 'Error obteniendo estadísticas' });
            }
        });

        // API endpoint para conversaciones por usuario
        this.app.get('/api/conversations/:userId/:date?', async (req, res) => {
            try {
                const { userId, date } = req.params;
                const logs = await logger.getLogs(date);
                
                const userLogs = logs.filter(log => log.userId === userId);
                
                // Formatear mensajes para incluir mensajes de sistema
                const formattedLogs = userLogs.map(log => {
                    // Detectar mensajes de finalización de sesión
                    if (log.type === 'BOT' && log.message && log.message.includes('⏰') && log.message.includes('sesión')) {
                        return {
                            ...log,
                            type: 'SYSTEM',
                            isSessionEnd: true
                        };
                    }
                    return log;
                });
                
                res.json(formattedLogs);
            } catch (error) {
                console.error('Error obteniendo conversaciones:', error);
                res.status(500).json({ error: 'Error obteniendo conversaciones' });
            }
        });

        // API endpoints para gestión de modo humano
        this.app.get('/api/human-states', async (req, res) => {
            try {
                const humanStates = await humanModeManager.getAllHumanStates();
                res.json(humanStates);
            } catch (error) {
                console.error('Error obteniendo estados humanos:', error);
                res.status(500).json({ error: 'Error obteniendo estados humanos' });
            }
        });

        this.app.post('/api/human-states', (req, res) => {
            try {
                const { phone, isHumanMode, mode } = req.body;
                
                if (!phone) {
                    return res.status(400).json({ error: 'Phone number is required' });
                }
                
                // Si se proporciona un modo específico (support, human, ai)
                if (mode) {
                    humanModeManager.setMode(phone, mode === 'ai' ? false : mode);
                    const modeText = mode === 'support' ? 'SOPORTE' : mode === 'human' ? 'HUMANO' : 'IA';
                    logger.log('SYSTEM', `Modo ${modeText} establecido para ${phone}`);
                    
                    res.json({ 
                        success: true, 
                        phone, 
                        mode,
                        isHumanMode: mode === 'human',
                        message: `Modo ${modeText} activado para ${phone}`
                    });
                } else {
                    // Compatibilidad con el método anterior
                    humanModeManager.setHumanMode(phone, isHumanMode);
                    logger.log('SYSTEM', `Modo ${isHumanMode ? 'HUMANO' : 'IA'} establecido para ${phone}`);
                    
                    res.json({ 
                        success: true, 
                        phone, 
                        isHumanMode,
                        message: `Modo ${isHumanMode ? 'HUMANO' : 'IA'} activado para ${phone}`
                    });
                }
            } catch (error) {
                console.error('Error actualizando estado humano:', error);
                res.status(500).json({ error: 'Error interno del servidor' });
            }
        });

        this.app.delete('/api/human-states/:phone', (req, res) => {
            try {
                const { phone } = req.params;
                humanModeManager.removeContact(phone);
                logger.log('SYSTEM', `Contacto ${phone} removido de gestión humana`);
                
                res.json({ 
                    success: true, 
                    message: `Contacto ${phone} removido`
                });
            } catch (error) {
                console.error('Error removiendo contacto:', error);
                res.status(500).json({ error: 'Error interno del servidor' });
            }
        });

        // API endpoint para obtener reportes con información de ventas
        this.app.get('/api/reports/:date?', async (req, res) => {
            try {
                let dateParam = req.params.date || 'all';
                let logs = [];
                
                // Manejar diferentes tipos de fecha
                if (dateParam === 'all') {
                    // Obtener TODOS los logs de la BD sin filtro de fecha
                    logs = await logger.getLogs(null, 10000); // null = sin filtro de fecha, 10000 = límite alto
                } else if (dateParam === 'month') {
                    // Obtener todos los logs del mes actual
                    const today = new Date();
                    const year = today.getFullYear();
                    const month = String(today.getMonth() + 1).padStart(2, '0');
                    
                    // Obtener todos los días del mes
                    const daysInMonth = new Date(year, today.getMonth() + 1, 0).getDate();
                    for (let day = 1; day <= daysInMonth; day++) {
                        const dateStr = `${year}-${month}-${String(day).padStart(2, '0')}`;
                        const dayLogs = await logger.getLogs(dateStr);
                        logs = logs.concat(dayLogs);
                    }
                } else if (dateParam === 'week') {
                    // Obtener logs de la última semana
                    const today = new Date();
                    for (let i = 0; i < 7; i++) {
                        const date = new Date(today);
                        date.setDate(date.getDate() - i);
                        const dateStr = date.toISOString().split('T')[0];
                        const dayLogs = await logger.getLogs(dateStr);
                        logs = logs.concat(dayLogs);
                    }
                } else if (dateParam === 'today') {
                    const date = new Date().toISOString().split('T')[0];
                    logs = await logger.getLogs(date);
                } else if (dateParam === 'yesterday') {
                    const yesterday = new Date();
                    yesterday.setDate(yesterday.getDate() - 1);
                    const date = yesterday.toISOString().split('T')[0];
                    logs = await logger.getLogs(date);
                } else {
                    // Fecha específica
                    logs = await logger.getLogs(dateParam);
                }
                const salesData = await salesManager.getAllSalesData();
                const humanStates = await humanModeManager.getAllHumanStates();
                
                // Agrupar conversaciones por usuario
                const conversationsByUser = {};
                
                logs.forEach(log => {
                    if (!log.userId) return;
                    
                    // Obtener fecha del log
                    const logDate = new Date(log.timestamp).toISOString().split('T')[0];
                    
                    if (!conversationsByUser[log.userId]) {
                        conversationsByUser[log.userId] = {
                            id: '',
                            telefono: log.userId,
                            fecha: logDate,
                            hora: '',
                            mensajes: 0,
                            posibleVenta: false,
                            ventaCerrada: false,
                            citaAgendada: false,
                            soporteActivado: false,
                            modoHumano: false,
                            conversacion: [],
                            primerMensaje: null,
                            ultimoMensaje: null
                        };
                    }
                    
                    const conv = conversationsByUser[log.userId];
                    
                    // Contar mensajes (incluir todos los tipos relevantes)
                    if (log.type === 'USER' || log.type === 'BOT' || log.type === 'HUMAN' || 
                        log.role === 'cliente' || log.role === 'bot' || log.role === 'soporte') {
                        conv.mensajes++;
                        conv.conversacion.push({
                            type: log.type,
                            role: log.role,
                            message: log.message,
                            timestamp: log.timestamp
                        });
                        
                        // Registrar primer y último mensaje
                        if (!conv.primerMensaje) {
                            conv.primerMensaje = log.timestamp;
                            conv.hora = new Date(log.timestamp).toLocaleTimeString('es-ES', {
                                hour: '2-digit',
                                minute: '2-digit'
                            });
                        }
                        conv.ultimoMensaje = log.timestamp;
                    }
                    
                    // Detectar si hubo soporte o modo humano
                    if (log.type === 'HUMAN' || log.role === 'soporte') {
                        conv.soporteActivado = true;
                    }
                    if (log.type === 'SYSTEM' && log.message && log.message.includes('Modo SOPORTE activado')) {
                        conv.soporteActivado = true;
                    }
                    if (log.type === 'SYSTEM' && log.message && log.message.includes('Modo HUMANO establecido')) {
                        conv.modoHumano = true;
                    }
                });
                
                // Generar reportes finales
                const reports = [];
                let idCounter = 1;
                
                for (const [userId, conv] of Object.entries(conversationsByUser)) {
                    // Generar ID único para la conversación usando la fecha real del log
                    const conversationId = salesManager.generateConversationId(userId, conv.fecha);
                    conv.id = `${conv.fecha}-${String(idCounter).padStart(3, '0')}`;
                    
                    // Obtener estado de ventas (AWAIT es crítico aquí)
                    const saleStatus = await salesManager.getSaleStatus(conversationId);
                    conv.posibleVenta = saleStatus.posibleVenta || false;
                    conv.ventaCerrada = saleStatus.ventaCerrada || saleStatus.analizadoIA || false;
                    conv.analizadoIA = saleStatus.analizadoIA || false;
                    conv.citaAgendada = saleStatus.citaAgendada || false;
                    
                    console.log(`Estado cargado para ${userId}:`, {
                        posibleVenta: conv.posibleVenta,
                        analizadoIA: conv.analizadoIA,
                        citaAgendada: conv.citaAgendada
                    });
                    
                    // Verificar estado actual de modo humano/soporte
                    const currentMode = humanModeManager.getMode(userId);
                    if (currentMode === 'support') {
                        conv.soporteActivado = true;
                    } else if (currentMode === 'human' || currentMode === true) {
                        conv.modoHumano = true;
                    }
                    
                    reports.push(conv);
                    idCounter++;
                }
                
                // Ordenar por hora de primer mensaje
                reports.sort((a, b) => {
                    if (a.primerMensaje && b.primerMensaje) {
                        return new Date(a.primerMensaje) - new Date(b.primerMensaje);
                    }
                    return 0;
                });
                
                res.json(reports);
            } catch (error) {
                console.error('Error generando reportes:', error);
                res.status(500).json({ error: 'Error interno del servidor' });
            }
        });

        // API endpoint para actualizar estado de venta
        this.app.post('/api/reports/sale-status', async (req, res) => {
            try {
                const { conversationId, phone, date, posibleVenta, ventaCerrada, citaAgendada, notas } = req.body;
                
                let id = conversationId;
                if (!id && phone && date) {
                    id = salesManager.generateConversationId(phone, date);
                }
                
                if (!id) {
                    return res.status(400).json({ error: 'Se requiere conversationId o phone y date' });
                }
                
                // Guardar en la base de datos usando setSaleStatus
                const result = await salesManager.setSaleStatus(id, {
                    posibleVenta,
                    ventaCerrada,
                    citaAgendada,
                    notas
                });
                
                res.json({ success: true, data: result });
            } catch (error) {
                console.error('Error actualizando estado de venta:', error);
                res.status(500).json({ error: 'Error interno del servidor' });
            }
        });

        // API endpoint para obtener estadísticas de ventas
        this.app.get('/api/sales-stats/:date?', (req, res) => {
            try {
                const date = req.params.date || null;
                const stats = salesManager.getSalesStats(date);
                res.json(stats);
            } catch (error) {
                console.error('Error obteniendo estadísticas de ventas:', error);
                res.status(500).json({ error: 'Error interno del servidor' });
            }
        });

        // API endpoint para analizar conversación con IA
        this.app.post('/api/analyze-conversation', async (req, res) => {
            try {
                const { messages, userId } = req.body;

                if (!messages || !Array.isArray(messages)) {
                    return res.status(400).json({ error: 'Se requiere un array de mensajes' });
                }

                const analysis = await conversationAnalyzer.analyzeConversation(messages, userId);
                res.json(analysis);
            } catch (error) {
                console.error('Error analizando conversación:', error);
                res.status(500).json({ error: 'Error interno del servidor' });
            }
        });

        // ===== ENDPOINTS DE GESTIÓN DE DATOS DE USUARIO =====

        // API endpoint para obtener datos de usuarios
        this.app.get('/api/user-data', async (req, res) => {
            try {
                const users = await userDataManager.getAllUsersData();
                res.json(users);
            } catch (error) {
                console.error('Error obteniendo datos de usuarios:', error);
                res.status(500).json({ error: 'Error obteniendo datos de usuarios' });
            }
        });

        // API endpoint para obtener datos de un usuario específico
        this.app.get('/api/user-data/:userId', async (req, res) => {
            try {
                const { userId } = req.params;
                const userData = await userDataManager.getUserData(userId);

                if (userData) {
                    res.json(userData);
                } else {
                    res.status(404).json({ error: 'Usuario no encontrado' });
                }
            } catch (error) {
                console.error('Error obteniendo datos del usuario:', error);
                res.status(500).json({ error: 'Error obteniendo datos del usuario' });
            }
        });

        // API endpoint para actualizar datos de usuario (solo admin)
        this.app.put('/api/user-data/:userId', requireAdmin, async (req, res) => {
            try {
                const { userId } = req.params;
                const { name, email } = req.body;

                const updatedData = await userDataManager.setUserData(userId, { name, email });
                res.json(updatedData);
            } catch (error) {
                console.error('Error actualizando datos del usuario:', error);
                res.status(500).json({ error: 'Error actualizando datos del usuario' });
            }
        });

        // API endpoint para eliminar datos de usuario (solo admin)
        this.app.delete('/api/user-data/:userId', requireAdmin, async (req, res) => {
            try {
                const { userId } = req.params;
                const success = await userDataManager.deleteUserData(userId);

                if (success) {
                    res.json({ success: true, message: 'Datos de usuario eliminados' });
                } else {
                    res.status(500).json({ error: 'Error eliminando datos del usuario' });
                }
            } catch (error) {
                console.error('Error eliminando datos del usuario:', error);
                res.status(500).json({ error: 'Error eliminando datos del usuario' });
            }
        });

        // ===== ENDPOINTS DE GESTIÓN DE CSV (SOLO ADMIN) =====
        
        // Configurar multer para subida de archivos
        const upload = multer({ 
            limits: { fileSize: 10 * 1024 * 1024 }, // Límite de 10MB
            fileFilter: (req, file, cb) => {
                if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
                    cb(null, true);
                } else {
                    cb(new Error('Solo se permiten archivos CSV'));
                }
            }
        });

        // Subir archivo CSV
        this.app.post('/api/csv/upload', requireAdmin, upload.single('csv'), async (req, res) => {
            try {
                if (!req.file) {
                    return res.status(400).json({ error: 'No se proporcionó archivo CSV' });
                }

                const result = await csvService.saveCSV(
                    req.file.originalname,
                    req.file.buffer.toString('utf8')
                );

                res.json(result);
            } catch (error) {
                console.error('Error subiendo CSV:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Listar archivos CSV subidos
        this.app.get('/api/csv/list', requireAdmin, async (req, res) => {
            try {
                const files = await csvService.listCSVFiles();
                res.json({ files });
            } catch (error) {
                console.error('Error listando CSVs:', error);
                res.status(500).json({ error: 'Error obteniendo lista de archivos' });
            }
        });

        // Eliminar archivo CSV
        this.app.delete('/api/csv/delete/:filename', requireAdmin, async (req, res) => {
            try {
                const result = await csvService.deleteCSV(req.params.filename);
                res.json(result);
            } catch (error) {
                console.error('Error eliminando CSV:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Descargar plantilla CSV
        this.app.get('/api/csv/template', (req, res) => {
            try {
                const templateContent = `Parque Industrial,Ubicación,Tipo,Ancho,Largo,Area (m2),Precio,Estado,Información Extra,Ventajas Estratégicas
Vernes,Carr. México - Qro,Nave Industrial,50,30,1500,750000,Disponible,Incluye oficinas administrativas,Acceso directo a autopistas principales
LuisOnorio,Av. Constituyentes,Micronave,25,20,500,350000,Pre-Venta,Cuenta con muelle de carga,Zona de alto flujo comercial`;

                res.setHeader('Content-Type', 'text/csv');
                res.setHeader('Content-Disposition', 'attachment; filename="plantilla_naves.csv"');
                res.send(templateContent);
            } catch (error) {
                console.error('Error descargando plantilla CSV:', error);
                res.status(500).json({ error: 'Error generando plantilla' });
            }
        });

        // Buscar en CSVs (endpoint interno para la IA)
        this.app.post('/api/csv/search', requireAuth, async (req, res) => {
            try {
                const { query } = req.body;
                if (!query) {
                    return res.status(400).json({ error: 'Query es requerido' });
                }

                const results = await csvService.searchInCSV(query);
                res.json({ results });
            } catch (error) {
                console.error('Error buscando en CSV:', error);
                res.status(500).json({ error: 'Error en la búsqueda' });
            }
        });

        // ===== ENDPOINTS DE VOICEBOT (SOLO ADMIN) =====

        const voicebotDB = require('../services/voicebot/voicebotDatabase');
        const campaignManager = require('../services/voicebot/campaignManager');

        // Crear campaña desde CSV
        // Descargar plantilla CSV de ejemplo
        this.app.get('/api/voicebot/campaigns/template', requireAdmin, (req, res) => {
            try {
                const csvContent = `Teléfono,Nombre,Tipo de Nave,Ubicación,Tamaño,Precio,Información Adicional,Ventajas Estratégicas
7771234567,Juan Pérez,Industrial,Torreón Coahuila,500 metros cuadrados,3 millones 500 mil pesos mexicanos,Nave ideal para almacenamiento y distribución,Excelente ubicación cerca de la carretera principal con acceso a servicios
7779876543,María González,Comercial,Gómez Palacio,300 metros cuadrados,2 millones de pesos mexicanos,Ideal para centro de distribución,Zona comercial de alto tránsito
7775551234,Carlos Ramírez,Logística,Lerdo,800 metros cuadrados,5 millones 200 mil pesos mexicanos,Amplio espacio con muelles de carga,Acceso directo a carreteras federales`;

                res.setHeader('Content-Type', 'text/csv; charset=utf-8');
                res.setHeader('Content-Disposition', 'attachment; filename="plantilla_voicebot_navetec.csv"');
                res.send('\uFEFF' + csvContent); // BOM para UTF-8
            } catch (error) {
                console.error('Error generando plantilla CSV:', error);
                res.status(500).json({ error: error.message });
            }
        });

        this.app.post('/api/voicebot/campaigns/create', requireAdmin, upload.single('csv'), async (req, res) => {
            try {
                if (!req.file) {
                    return res.status(400).json({ error: 'No se proporcionó archivo CSV' });
                }

                const { campaignName } = req.body;

                if (!campaignName) {
                    return res.status(400).json({ error: 'El nombre de la campaña es requerido' });
                }

                // Guardar CSV temporalmente
                const tempPath = path.join(__dirname, '../../temp', `campaign_${Date.now()}.csv`);
                await require('fs').promises.mkdir(path.join(__dirname, '../../temp'), { recursive: true });
                await require('fs').promises.writeFile(tempPath, req.file.buffer);

                // Crear campaña
                const result = await campaignManager.createCampaignFromCSV(
                    tempPath,
                    campaignName,
                    req.user.id
                );

                // Eliminar archivo temporal
                await require('fs').promises.unlink(tempPath);

                res.json(result);
            } catch (error) {
                console.error('Error creando campaña:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Listar campañas
        this.app.get('/api/voicebot/campaigns', requireAdmin, async (req, res) => {
            try {
                const campaigns = await voicebotDB.getAllCampaigns();
                res.json({ campaigns });
            } catch (error) {
                console.error('Error obteniendo campañas:', error);
                res.status(500).json({ error: 'Error obteniendo campañas' });
            }
        });

        // Obtener campaña específica
        this.app.get('/api/voicebot/campaigns/:id', requireAdmin, async (req, res) => {
            try {
                const campaign = await voicebotDB.getCampaign(req.params.id);
                if (!campaign) {
                    return res.status(404).json({ error: 'Campaña no encontrada' });
                }
                res.json({ campaign });
            } catch (error) {
                console.error('Error obteniendo campaña:', error);
                res.status(500).json({ error: 'Error obteniendo campaña' });
            }
        });

        // Obtener estadísticas de campaña
        this.app.get('/api/voicebot/campaigns/:id/stats', requireAdmin, async (req, res) => {
            try {
                const stats = await campaignManager.getCampaignStats(req.params.id);
                res.json({ stats });
            } catch (error) {
                console.error('Error obteniendo estadísticas:', error);
                res.status(500).json({ error: 'Error obteniendo estadísticas' });
            }
        });

        // Iniciar campaña
        this.app.post('/api/voicebot/campaigns/:id/start', requireAdmin, async (req, res) => {
            try {
                const result = await campaignManager.startCampaign(req.params.id);
                res.json(result);
            } catch (error) {
                console.error('Error iniciando campaña:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Pausar campaña
        this.app.post('/api/voicebot/campaigns/:id/pause', requireAdmin, async (req, res) => {
            try {
                await campaignManager.pauseCampaign(req.params.id);
                res.json({ success: true, message: 'Campaña pausada' });
            } catch (error) {
                console.error('Error pausando campaña:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Detener campaña
        this.app.post('/api/voicebot/campaigns/:id/stop', requireAdmin, async (req, res) => {
            try {
                await campaignManager.stopCampaign(req.params.id);
                res.json({ success: true, message: 'Campaña detenida' });
            } catch (error) {
                console.error('Error deteniendo campaña:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Eliminar campaña
        this.app.delete('/api/voicebot/campaigns/:id', requireAdmin, async (req, res) => {
            try {
                const campaignId = req.params.id;

                // Verificar que la campaña existe
                const campaign = await voicebotDB.getCampaign(campaignId);
                if (!campaign) {
                    return res.status(404).json({ error: 'Campaña no encontrada' });
                }

                // Verificar que la campaña no esté activa
                if (campaign.status === 'running') {
                    return res.status(400).json({ error: 'No se puede eliminar una campaña activa. Primero detén la campaña.' });
                }

                // Eliminar registros relacionados en orden (por foreign keys)
                const database = require('../services/database');
                await database.query('DELETE FROM voicebot_appointments WHERE campaign_id = ?', [campaignId]);
                await database.query('DELETE FROM voicebot_transcriptions WHERE call_id IN (SELECT id FROM voicebot_calls WHERE campaign_id = ?)', [campaignId]);
                await database.query('DELETE FROM voicebot_calls WHERE campaign_id = ?', [campaignId]);
                await database.query('DELETE FROM voicebot_contacts WHERE campaign_id = ?', [campaignId]);
                await database.query('DELETE FROM voicebot_campaigns WHERE id = ?', [campaignId]);

                res.json({ success: true, message: 'Campaña eliminada exitosamente' });
            } catch (error) {
                console.error('Error eliminando campaña:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Obtener llamadas de una campaña
        this.app.get('/api/voicebot/campaigns/:id/calls', requireAdmin, async (req, res) => {
            try {
                const sql = `
                    SELECT c.*, co.client_name, co.phone_number
                    FROM voicebot_calls c
                    LEFT JOIN voicebot_contacts co ON c.contact_id = co.id
                    WHERE c.campaign_id = ?
                    ORDER BY c.call_start DESC
                `;
                const calls = await require('../services/database').query(sql, [req.params.id]);
                res.json({ calls });
            } catch (error) {
                console.error('Error obteniendo llamadas:', error);
                res.status(500).json({ error: 'Error obteniendo llamadas' });
            }
        });

        // Obtener transcripción de una llamada
        this.app.get('/api/voicebot/calls/:id/transcription', requireAdmin, async (req, res) => {
            try {
                const transcription = await voicebotDB.getFullConversation(req.params.id);
                res.json({ transcription });
            } catch (error) {
                console.error('Error obteniendo transcripción:', error);
                res.status(500).json({ error: 'Error obteniendo transcripción' });
            }
        });

        // Obtener TODAS las citas agendadas (todas las campañas)
        this.app.get('/api/voicebot/appointments', requireAdmin, async (req, res) => {
            try {
                const appointments = await voicebotDB.getAllAppointments();
                res.json({ appointments });
            } catch (error) {
                console.error('Error obteniendo todas las citas:', error);
                res.status(500).json({ error: 'Error obteniendo citas' });
            }
        });

        // Obtener citas agendadas de una campaña específica
        this.app.get('/api/voicebot/campaigns/:id/appointments', requireAdmin, async (req, res) => {
            try {
                const appointments = await voicebotDB.getAppointmentsByCampaign(req.params.id);
                res.json({ appointments });
            } catch (error) {
                console.error('Error obteniendo citas:', error);
                res.status(500).json({ error: 'Error obteniendo citas' });
            }
        });

        // Actualizar estado de cita
        this.app.put('/api/voicebot/appointments/:id/status', requireAdmin, async (req, res) => {
            try {
                const { status } = req.body;
                if (!['scheduled', 'confirmed', 'cancelled', 'completed', 'no_show'].includes(status)) {
                    return res.status(400).json({ error: 'Estado inválido' });
                }

                await voicebotDB.updateAppointmentStatus(req.params.id, status);
                res.json({ success: true, message: 'Estado actualizado' });
            } catch (error) {
                console.error('Error actualizando cita:', error);
                res.status(500).json({ error: 'Error actualizando cita' });
            }
        });

        // Actualizar cita completa (editar)
        this.app.put('/api/voicebot/appointments/:id', requireAdmin, async (req, res) => {
            try {
                const appointmentId = req.params.id;
                const { appointment_date, appointment_time, appointment_notes, client_name, phone_number } = req.body;

                const database = require('../services/database');

                const updateData = {};
                if (appointment_date) updateData.appointment_date = appointment_date;
                if (appointment_time) updateData.appointment_time = appointment_time;
                if (appointment_notes) updateData.appointment_notes = appointment_notes;
                if (client_name) updateData.client_name = client_name;
                if (phone_number) updateData.phone_number = phone_number;

                // Actualizar appointment_datetime si se proporcionan fecha y hora
                if (appointment_date && appointment_time) {
                    updateData.appointment_datetime = `${appointment_date} ${appointment_time}`;
                }

                await database.update('voicebot_appointments', updateData, 'id = ?', [appointmentId]);

                res.json({ success: true, message: 'Cita actualizada exitosamente' });
            } catch (error) {
                console.error('Error actualizando cita:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Eliminar cita
        this.app.delete('/api/voicebot/appointments/:id', requireAdmin, async (req, res) => {
            try {
                const appointmentId = req.params.id;
                const database = require('../services/database');

                await database.query('DELETE FROM voicebot_appointments WHERE id = ?', [appointmentId]);

                res.json({ success: true, message: 'Cita eliminada exitosamente' });
            } catch (error) {
                console.error('Error eliminando cita:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Obtener configuración del voicebot
        this.app.get('/api/voicebot/config', requireAdmin, async (req, res) => {
            try {
                const config = await voicebotDB.getAllConfig();
                const configObj = {};
                for (const item of config) {
                    configObj[item.config_key] = item.config_value;
                }
                res.json({ config: configObj });
            } catch (error) {
                console.error('Error obteniendo configuración:', error);
                res.status(500).json({ error: 'Error obteniendo configuración' });
            }
        });

        // Actualizar configuración del voicebot
        this.app.put('/api/voicebot/config', requireAdmin, async (req, res) => {
            try {
                const { key, value } = req.body;
                if (!key || value === undefined) {
                    return res.status(400).json({ error: 'Key y value son requeridos' });
                }

                await voicebotDB.setConfig(key, value, req.user.id);
                res.json({ success: true, message: 'Configuración actualizada' });
            } catch (error) {
                console.error('Error actualizando configuración:', error);
                res.status(500).json({ error: 'Error actualizando configuración' });
            }
        });

        // Estado del sistema voicebot
        this.app.get('/api/voicebot/status', requireAdmin, async (req, res) => {
            try {
                const ariManager = require('../services/voicebot/ariManager');

                res.json({
                    status: 'operational',
                    asteriskConnected: ariManager.isConnected(),
                    activeCampaigns: campaignManager.getActiveCampaigns(),
                    activeCallsCount: campaignManager.activeCallsCount || 0,
                    maxConcurrentCalls: campaignManager.maxConcurrentCalls || 2
                });
            } catch (error) {
                console.error('Error obteniendo estado:', error);
                res.status(500).json({ error: 'Error obteniendo estado' });
            }
        });

        // Resetear contador de llamadas
        this.app.post('/api/voicebot/reset-calls', requireAdmin, async (req, res) => {
            try {
                const result = campaignManager.resetCallsCounter();
                res.json(result);
            } catch (error) {
                console.error('Error reseteando:', error);
                res.status(500).json({ error: 'Error reseteando contador' });
            }
        });

        // Servir React app para todas las rutas no-API (solo en producción)
        if (process.env.NODE_ENV === 'production') {
            this.app.get('*', (req, res) => {
                res.sendFile(path.join(__dirname, '../../dist', 'index.html'));
            });
        }

        // API endpoint para finalizar conversación
        this.app.post('/api/end-conversation', async (req, res) => {
            try {
                const { phone } = req.body;
                
                if (!phone) {
                    return res.status(400).json({ 
                        error: 'Phone is required',
                        details: 'Debe proporcionar el teléfono'
                    });
                }
                
                // Verificar si hay una instancia activa del bot
                if (!global.whatsappBot || !global.whatsappBot.sock) {
                    return res.status(503).json({ 
                        error: 'WhatsApp bot not available',
                        details: 'El bot de WhatsApp no está conectado'
                    });
                }
                
                // Formatear el número de teléfono para WhatsApp (Baileys usa @s.whatsapp.net)
                const formattedPhone = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`;
                
                // Enviar mensaje de finalización
                const endMessage = '⏰ Tu sesión de conversación ha finalizado. Puedes escribirme nuevamente para iniciar una nueva conversación.';
                await global.whatsappBot.sock.sendMessage(formattedPhone, { text: endMessage });
                
                // Registrar el mensaje de finalización en los logs como mensaje del BOT
                logger.log('BOT', endMessage, phone);
                
                // Limpiar la sesión
                const sessionManager = require('../services/sessionManager');
                sessionManager.clearSession(phone);
                
                // Cambiar a modo IA si estaba en modo humano
                humanModeManager.setMode(phone, false);
                
                // Registrar el evento
                logger.log('SYSTEM', `Conversación finalizada manualmente para ${phone}`, phone);
                
                res.json({ 
                    success: true, 
                    message: 'Conversación finalizada correctamente',
                    phone: phone
                });
                
            } catch (error) {
                console.error('Error finalizando conversación:', error);
                res.status(500).json({ 
                    error: 'Error al finalizar conversación',
                    details: error.message 
                });
            }
        });

        // API endpoint para enviar mensajes
        this.app.post('/api/send-message', requireAuth, async (req, res) => {
            try {
                const { phone, message } = req.body;
                
                if (!phone || !message) {
                    return res.status(400).json({ 
                        error: 'Phone and message are required',
                        details: 'Debe proporcionar el teléfono y el mensaje'
                    });
                }
                
                // Verificar si hay una instancia activa del bot
                if (!global.whatsappBot) {
                    return res.status(503).json({ 
                        error: 'WhatsApp bot not available',
                        details: 'La instancia del bot no está disponible'
                    });
                }
                
                if (!global.whatsappBot.sock) {
                    return res.status(503).json({ 
                        error: 'WhatsApp client not connected',
                        details: 'El cliente de WhatsApp no está conectado. Por favor, escanee el código QR.'
                    });
                }
                
                // Formatear el número de teléfono para WhatsApp (Baileys usa @s.whatsapp.net)
                const formattedPhone = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`;
                
                // Enviar mensaje através del cliente de WhatsApp
                await global.whatsappBot.sock.sendMessage(formattedPhone, { text: message });
                
                // Registrar el mensaje enviado por el humano con el nombre del usuario
                const senderName = req.user ? req.user.name : 'Soporte';
                // Usar 'soporte' como role para la base de datos
                await logger.log('soporte', message, phone.replace('@s.whatsapp.net', ''), senderName);
                
                res.json({ 
                    success: true, 
                    message: 'Mensaje enviado correctamente',
                    phone: phone,
                    sentMessage: message
                });
                
            } catch (error) {
                console.error('Error enviando mensaje:', error);
                
                let errorMessage = 'Error interno del servidor';
                if (error.message.includes('Chat not found')) {
                    errorMessage = 'No se encontró el chat con este número';
                } else if (error.message.includes('not registered')) {
                    errorMessage = 'El número no está registrado en WhatsApp';
                } else if (error.message.includes('Session not authenticated')) {
                    errorMessage = 'El bot no está autenticado en WhatsApp';
                }
                
                res.status(500).json({ 
                    error: 'Failed to send message',
                    details: errorMessage,
                    originalError: error.message
                });
            }
        });
    }

    calculateStats(logs) {
        const stats = {
            totalMessages: 0,
            userMessages: 0,
            botMessages: 0,
            errors: 0,
            uniqueUsers: new Set(),
            messagesByHour: {},
            averageResponseLength: 0
        };

        let totalResponseLength = 0;
        let responseCount = 0;

        // Verificar que logs sea un array
        if (!Array.isArray(logs)) {
            console.warn('calculateStats: logs no es un array', typeof logs);
            return {
                ...stats,
                uniqueUsers: stats.uniqueUsers.size
            };
        }

        logs.forEach(log => {
            if (log.type === 'USER') {
                stats.userMessages++;
                stats.totalMessages++;
                if (log.userId) stats.uniqueUsers.add(log.userId);
            } else if (log.type === 'BOT') {
                stats.botMessages++;
                stats.totalMessages++;
                totalResponseLength += log.message.length;
                responseCount++;
            } else if (log.type === 'ERROR') {
                stats.errors++;
            }

            // Agrupar por hora
            const hour = new Date(log.timestamp).getHours();
            stats.messagesByHour[hour] = (stats.messagesByHour[hour] || 0) + 1;
        });

        stats.uniqueUsers = stats.uniqueUsers.size;
        stats.averageResponseLength = responseCount > 0 ? 
            Math.round(totalResponseLength / responseCount) : 0;

        return stats;
    }

    async start() {
        if (process.env.NODE_ENV === 'production') {
            // En producción, usar servidor Express normal
            this.app.listen(this.port, () => {
                console.log(`📊 Servidor web de reportes en http://localhost:${this.port}`);
                logger.log('SYSTEM', `Servidor web iniciado en puerto ${this.port}`);
            });
        } else {
            // En desarrollo, usar ViteExpress para integrar Vite
            const server = this.app.listen(this.port, () => {
                console.log(`📊 Servidor web con Vite en http://localhost:${this.port}`);
                logger.log('SYSTEM', `Servidor web con Vite iniciado en puerto ${this.port}`);
            });
            
            // Configurar ViteExpress
            ViteExpress.config({ 
                mode: 'development',
                viteConfigFile: path.join(__dirname, '../../vite.config.js')
            });
            
            // Bind Vite middleware a Express
            await ViteExpress.bind(this.app, server);
        }
    }
}

module.exports = WebServer;