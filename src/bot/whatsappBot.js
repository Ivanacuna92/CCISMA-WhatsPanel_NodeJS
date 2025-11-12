const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const config = require("../config/config");
const logger = require("../services/logger");
const aiService = require("../services/aiService");
const sessionManager = require("../services/sessionManager");
const promptLoader = require("../services/promptLoader");
const humanModeManager = require("../services/humanModeManager");
const conversationAnalyzer = require("../services/conversationAnalyzer");
const userDataManager = require("../services/userDataManager");
const followUpManager = require("../services/followUpManager");
const database = require("../services/database");

class WhatsAppBot {
  constructor() {
    this.client = null;
    this.systemPrompt = promptLoader.getPrompt();
    this.currentQR = null;
    this.isReady = false;
    this.messageProcessingQueue = new Map();
  }

  async start() {
    console.log("Iniciando bot de WhatsApp con whatsapp-web.js...");
    config.validateApiKey();

    try {
      // Crear cliente de WhatsApp con autenticación local
      const puppeteerConfig = {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-dev-profile',
          '--disable-software-rasterizer',
          '--disable-extensions',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-features=IsolateOrigins,site-per-process',
          '--disable-blink-features=AutomationControlled',
          '--disable-ipc-flooding-protection'
        ]
      };

      // Intentar usar Chrome del sistema (útil en macOS y algunos Linux)
      const fs = require('fs');
      const chromePaths = [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium'
      ];

      for (const chromePath of chromePaths) {
        if (fs.existsSync(chromePath)) {
          console.log(`Usando Chrome del sistema: ${chromePath}`);
          puppeteerConfig.executablePath = chromePath;
          break;
        }
      }

      // Si no encontró Chrome del sistema, usar el bundled de Puppeteer
      if (!puppeteerConfig.executablePath) {
        console.log('Usando Chromium bundled de Puppeteer');
      }

      this.client = new Client({
        authStrategy: new LocalAuth({
          dataPath: "./.wwebjs_auth"
        }),
        puppeteer: puppeteerConfig,
        webVersionCache: {
          type: 'remote',
          remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
        }
      });

      // Evento: QR Code generado
      this.client.on("qr", (qr) => {
        console.log("Escanea este código QR con WhatsApp:");
        console.log("O visita: http://tu-servidor:" + config.webPort + "/qr");
        this.currentQR = qr;
        qrcode.generate(qr, { small: true });
      });

      // Evento: Cliente listo
      this.client.on("ready", async () => {
        console.log("¡Bot de WhatsApp conectado y listo!");
        this.currentQR = null;
        this.isReady = true;
        logger.log("SYSTEM", "Bot iniciado correctamente con whatsapp-web.js");

        // Procesar mensajes pendientes
        console.log(
          "🔄 Verificando mensajes pendientes de cuando el bot estaba desconectado..."
        );
        setTimeout(() => {
          this.processPendingMessages().catch((err) => {
            console.error(
              "[PendingMessages] Error al procesar mensajes pendientes:",
              err
            );
          });
        }, 3000);

        // Inicializar follow-up manager
        followUpManager.initialize().then(() => {
          followUpManager.startFollowUpTimer(
            this.client,
            aiService,
            sessionManager
          );
        });

        // Iniciar timer de limpieza de sesiones
        sessionManager.startCleanupTimer(this.client, followUpManager);
      });

      // Evento: Autenticación exitosa
      this.client.on("authenticated", () => {
        console.log("Cliente autenticado correctamente");
      });

      // Evento: Fallo de autenticación
      this.client.on("auth_failure", (msg) => {
        console.error("Fallo en la autenticación:", msg);
        logger.log("ERROR", "Fallo en la autenticación: " + msg);
      });

      // Evento: Cliente desconectado
      this.client.on("disconnected", (reason) => {
        console.log("Cliente desconectado:", reason);
        this.isReady = false;
        logger.log("SYSTEM", "Bot desconectado: " + reason);
      });

      // Evento: Mensaje recibido
      this.client.on("message", async (msg) => {
        try {
          // Log para debugging
          console.log(
            "Mensaje recibido - fromMe:",
            msg.fromMe,
            "from:",
            msg.from
          );

          // Ignorar mensajes propios
          if (msg.fromMe) {
            console.log("Ignorando mensaje propio");
            return;
          }

          // Solo responder a mensajes privados (no grupos)
          const chat = await msg.getChat();
          if (chat.isGroup) {
            console.log("Ignorando mensaje de grupo");
            return;
          }

          // Ignorar mensajes sin texto
          if (!msg.body || msg.body.trim() === "") {
            console.log("Mensaje ignorado - Sin contenido de texto");
            return;
          }

          // Extraer información del usuario
          const from = msg.from; // formato: 1234567890@c.us
          const userId = from.replace("@c.us", "");
          const contact = await msg.getContact();
          const userName = contact.pushname || contact.name || userId;
          const conversation = msg.body;

          // Sistema de debounce para evitar procesamiento duplicado
          const messageKey = `${userId}_${conversation}_${Date.now()}`;

          // Verificar si ya estamos procesando un mensaje similar
          const recentKey = Array.from(this.messageProcessingQueue.keys()).find(
            (key) => {
              const [id, content] = key.split("_");
              return id === userId && content === conversation;
            }
          );

          if (
            recentKey &&
            Date.now() - this.messageProcessingQueue.get(recentKey) < 2000
          ) {
            console.log(`Mensaje duplicado ignorado de ${userId}`);
            return;
          }

          // Marcar mensaje como en procesamiento
          this.messageProcessingQueue.set(messageKey, Date.now());

          // Limpiar mensajes antiguos del queue
          for (const [key, timestamp] of this.messageProcessingQueue.entries()) {
            if (Date.now() - timestamp > 5000) {
              this.messageProcessingQueue.delete(key);
            }
          }

          await logger.log("cliente", conversation, userId, userName);

          // Verificar si está en modo humano o soporte
          const isHuman = await humanModeManager.isHumanMode(userId);
          const isSupport = await humanModeManager.isSupportMode(userId);

          if (isHuman || isSupport) {
            const mode = isSupport ? "SOPORTE" : "HUMANO";
            await logger.log(
              "SYSTEM",
              `Mensaje ignorado - Modo ${mode} activo para ${userName} (${userId})`
            );
            this.messageProcessingQueue.delete(messageKey);

            // Detener seguimiento si está activo
            if (await followUpManager.isFollowUpActive(userId)) {
              await followUpManager.stopFollowUp(userId, "modo_humano_activo");
            }

            return;
          }

          // Procesar mensaje y generar respuesta
          const response = await this.processMessage(userId, conversation, from);

          // Enviar respuesta
          if (response && response.trim() !== "") {
            try {
              // Simular estado de "escribiendo"
              await chat.sendStateTyping();
              await new Promise(resolve => setTimeout(resolve, 300));

              // Enviar mensaje
              await msg.reply(response);

              console.log(`[WhatsApp] ✅ Mensaje enviado exitosamente a ${userId}`);

              await logger.log("bot", response, userId, userName);
            } catch (sendError) {
              console.error(`[WhatsApp] ❌ Error enviando mensaje a ${userId}:`, sendError);
              throw sendError;
            }
          }

          // Analizar estado de la conversación
          const conversationHistory = await sessionManager.getMessages(
            userId,
            from
          );
          const status = await aiService.analyzeConversationStatus(
            conversationHistory,
            conversation
          );

          console.log(
            `[FollowUp] Estado de conversación para ${userId}: ${status}`
          );

          // Manejar seguimientos basados en el estado
          if (
            status === "ACEPTADO" ||
            status === "RECHAZADO" ||
            status === "FRUSTRADO"
          ) {
            if (await followUpManager.isFollowUpActive(userId)) {
              await followUpManager.stopFollowUp(userId, status.toLowerCase());
            }
          } else if (status === "ACTIVO") {
            if (await followUpManager.isFollowUpActive(userId)) {
              await followUpManager.stopFollowUp(userId, "volvio_activo");
            }
          }

          // Eliminar del queue después de procesar
          this.messageProcessingQueue.delete(messageKey);
        } catch (error) {
          await this.handleError(error, msg);
        }
      });

      // Inicializar cliente
      await this.client.initialize();
    } catch (error) {
      console.error("Error iniciando bot:", error);
      logger.log("ERROR", "Error iniciando bot: " + error.message);
      throw error;
    }
  }

  async processMessage(userId, userMessage, chatId) {
    const dataCollectionState = userDataManager.getDataCollectionState(userId);

    // Verificar si estamos esperando el email para activar soporte
    if (dataCollectionState === "email_pending_for_support") {
      return await this.handleEmailCollection(userId, userMessage, chatId);
    }

    // Si es usuario nuevo, dar bienvenida y pedir nombre
    if (dataCollectionState === "none") {
      await userDataManager.setUserData(userId, {});

      // Agregar el mensaje del usuario primero
      await sessionManager.addMessage(userId, "user", userMessage, chatId);

      // Dar bienvenida y pedir nombre
      const welcomeMessage = `¡Hola! Soy Daniel, asistente virtual de Navetec.\n\n¿Con quién tengo el gusto?\n\n_Por favor, proporciona tu nombre completo`;
      await sessionManager.addMessage(
        userId,
        "assistant",
        welcomeMessage,
        chatId
      );
      return welcomeMessage;
    }

    // Detectar si el usuario está proporcionando un email o nombre directamente
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const trimmedMessage = userMessage.trim();

    // Detectar email
    if (emailRegex.test(trimmedMessage.toLowerCase())) {
      const email = trimmedMessage.toLowerCase();
      await userDataManager.setUserData(userId, { email: email });
      const userData = await userDataManager.getUserData(userId);

      // Marcar datos como completos si tiene nombre y email
      if (userData.name) {
        await userDataManager.markDataAsCollected(userId);
      }

      // Agregar mensaje del usuario a la sesión
      await sessionManager.addMessage(userId, "user", userMessage, chatId);

      const name = userData?.name ? ` ${userData.name}` : "";
      const confirmationMessage = `¡Gracias${name}! ✅\n\nHe registrado tu correo: ${email}\n\n¿En qué más puedo ayudarte?`;
      await sessionManager.addMessage(
        userId,
        "assistant",
        confirmationMessage,
        chatId
      );
      return confirmationMessage;
    }

    // Obtener historial para análisis
    let conversationHistory = await sessionManager.getMessages(userId, chatId);

    // Detectar si es un nombre
    const lastBotMessage = conversationHistory
      .filter((m) => m.role === "assistant")
      .slice(-1)[0];

    if (
      lastBotMessage &&
      (lastBotMessage.content.toLowerCase().includes("¿cómo puedo llamarte?") ||
        lastBotMessage.content.toLowerCase().includes("¿cuál es tu nombre?") ||
        lastBotMessage.content.toLowerCase().includes("tu nombre"))
    ) {
      // Validar que parezca un nombre
      if (userDataManager.isValidName(trimmedMessage)) {
        await userDataManager.setUserData(userId, { name: trimmedMessage });
        await userDataManager.markNameCollected(userId);

        await sessionManager.addMessage(userId, "user", userMessage, chatId);

        const confirmationMessage = `¡Mucho gusto, ${trimmedMessage}! ¿En qué más puedo ayudarte?`;
        await sessionManager.addMessage(
          userId,
          "assistant",
          confirmationMessage,
          chatId
        );
        return confirmationMessage;
      }
    }

    // Agregar mensaje del usuario a la sesión
    await sessionManager.addMessage(userId, "user", userMessage, chatId);

    // Actualizar historial
    conversationHistory = await sessionManager.getMessages(userId, chatId);

    // Analizar conversación y obtener asesor asignado
    let asesorAsignado = null;
    try {
      const analysis = await conversationAnalyzer.analyzeConversation(
        conversationHistory.map((msg) => ({
          type: msg.role === "user" ? "USER" : "BOT",
          message: msg.content,
        })),
        userId
      );
      asesorAsignado = analysis.asesor_asignado;
      console.log(
        `[Bot] Asesor asignado para ${userId}: ${asesorAsignado.nombre}`
      );
    } catch (error) {
      console.error("[Bot] Error analizando conversación:", error);
    }

    // Obtener datos del usuario para contexto
    const userData = await userDataManager.getUserData(userId);

    // Preparar prompt del sistema con información sobre datos del usuario
    let systemPromptWithContext = this.systemPrompt;

    if (userData) {
      systemPromptWithContext += `\n\n*DATOS DEL CLIENTE ACTUAL:*`;
      if (userData.name) {
        systemPromptWithContext += `\n- Nombre: ${userData.name} (YA TIENES EL NOMBRE, NO LO PIDAS DE NUEVO)`;
      } else {
        systemPromptWithContext += `\n- Nombre: No disponible (puedes pedirlo de forma natural después de 2-3 mensajes)`;
      }
      if (userData.email) {
        systemPromptWithContext += `\n- Correo: ${userData.email} (YA TIENES EL CORREO, NO LO PIDAS DE NUEVO)`;
      } else {
        systemPromptWithContext += `\n- Correo: No disponible (pídelo solo cuando sea necesario o al final de una conversación productiva)`;
      }
    }

    // Preparar mensajes para la IA
    const messages = [
      { role: "system", content: systemPromptWithContext },
      ...conversationHistory,
    ];

    // Generar respuesta con IA
    const aiResponse = await aiService.generateResponse(messages);

    // Verificar si la respuesta contiene el marcador de activar soporte
    if (aiResponse.includes("{{ACTIVAR_SOPORTE}}")) {
      // Verificar si tenemos el email del usuario
      const userData = await userDataManager.getUserData(userId);
      if (!userData || !userData.email) {
        const cleanResponse = aiResponse
          .replace("{{ACTIVAR_SOPORTE}}", "")
          .trim();

        if (cleanResponse.length > 0) {
          await sessionManager.addMessage(
            userId,
            "assistant",
            cleanResponse,
            chatId
          );
        }

        await userDataManager.setPendingSupportActivation(userId, true);

        const emailRequest = `Para poder asignarte un asesor especializado y mantener un seguimiento de tu caso, necesito tu correo electrónico.\n\n📧 Por favor, proporciona tu correo electrónico:`;
        return emailRequest;
      }

      // Si ya tenemos el email, activar soporte
      const cleanResponse = aiResponse
        .replace("{{ACTIVAR_SOPORTE}}", "")
        .trim();

      // Activar modo soporte
      await humanModeManager.setMode(userId, "support");
      await sessionManager.updateSessionMode(userId, chatId, "support");

      // Incluir información del asesor asignado
      let finalResponse = cleanResponse;
      if (asesorAsignado) {
        finalResponse +=
          `\n\n📋 *Asesor asignado:* ${asesorAsignado.nombre}\n` +
          `_Especialidad: ${asesorAsignado.especialidades.join(", ")}_`;
      }

      await sessionManager.addMessage(
        userId,
        "assistant",
        finalResponse,
        chatId
      );

      const logMessage = asesorAsignado
        ? `Modo SOPORTE activado para ${userId} - Asesor: ${asesorAsignado.nombre}`
        : `Modo SOPORTE activado automáticamente para ${userId}`;
      await logger.log("SYSTEM", logMessage);

      return finalResponse;
    }

    // Agregar respuesta de IA a la sesión
    await sessionManager.addMessage(userId, "assistant", aiResponse, chatId);

    return aiResponse;
  }

  async handleError(error, message) {
    console.error("Error procesando mensaje:", error);

    const from = message.from;
    const userId = from.replace("@c.us", "");

    let errorMessage = "Lo siento, ocurrió un error. Inténtalo de nuevo.";

    if (
      error.message.includes("autenticación") ||
      error.message.includes("API key")
    ) {
      errorMessage =
        "Error de configuración del bot. Por favor, contacta al administrador.";
    }

    try {
      await message.reply(errorMessage);
      logger.log("ERROR", error.message, userId);
    } catch (sendError) {
      console.error("Error enviando mensaje de error:", sendError);
    }
  }

  async stop() {
    console.log("Cerrando bot...");
    if (this.client) {
      await this.client.destroy();
    }
  }

  async clearSession() {
    const fs = require("fs").promises;
    const path = require("path");
    const authPath = path.join(process.cwd(), ".wwebjs_auth");

    try {
      await fs.rm(authPath, { recursive: true, force: true });
      console.log("Sesión eliminada correctamente");
    } catch (err) {
      console.log("No había sesión previa o ya fue eliminada");
    }
  }

  async logout() {
    console.log("Cerrando sesión de WhatsApp...");
    try {
      if (this.client) {
        await this.client.logout();
      }

      await this.clearSession();

      // Reiniciar el bot
      setTimeout(() => this.start(), 2000);
      return true;
    } catch (error) {
      console.error("Error al cerrar sesión:", error);
      return false;
    }
  }

  async handleEmailCollection(userId, userMessage, chatId) {
    // Validar y guardar email
    const email = userMessage.trim().toLowerCase();
    if (!userDataManager.isValidEmail(email)) {
      await sessionManager.addMessage(userId, "user", userMessage, chatId);
      const errorMessage = `Por favor, ingresa un correo electrónico válido (ejemplo: tucorreo@ejemplo.com):`;
      await sessionManager.addMessage(
        userId,
        "assistant",
        errorMessage,
        chatId
      );
      return errorMessage;
    }

    // Guardar email y marcar datos como completos
    await userDataManager.setUserData(userId, { email: email });
    await userDataManager.markDataAsCollected(userId);
    const userData = await userDataManager.getUserData(userId);

    // Verificar si había una activación de soporte pendiente
    if (await userDataManager.hasPendingSupportActivation(userId)) {
      await userDataManager.setPendingSupportActivation(userId, false);

      // Activar modo soporte
      await humanModeManager.setMode(userId, "support");
      await sessionManager.updateSessionMode(userId, chatId, "support");

      // Obtener asesor asignado
      const conversationHistory = await sessionManager.getMessages(
        userId,
        chatId
      );
      let asesorAsignado = null;

      try {
        const analysis = await conversationAnalyzer.analyzeConversation(
          conversationHistory.map((msg) => ({
            type: msg.role === "user" ? "USER" : "BOT",
            message: msg.content,
          })),
          userId
        );
        asesorAsignado = analysis.asesor_asignado;
      } catch (error) {
        console.error("[Bot] Error analizando conversación:", error);
      }

      // Preparar respuesta
      let response = `¡Perfecto ${userData.name}! ✅\n\nHe registrado tu correo: ${email}\n\nTe estoy transfiriendo con uno de nuestros asesores especializados que te ayudará con tu caso.`;

      if (asesorAsignado) {
        response +=
          `\n\n📋 *Asesor asignado:* ${asesorAsignado.nombre}\n` +
          `_Especialidad: ${asesorAsignado.especialidades.join(", ")}_`;
      }

      const logMessage = asesorAsignado
        ? `Modo SOPORTE activado para ${userId} - Asesor: ${asesorAsignado.nombre}`
        : `Modo SOPORTE activado para ${userId}`;
      await logger.log("SYSTEM", logMessage);

      await sessionManager.addMessage(userId, "assistant", response, chatId);

      return response;
    } else {
      return `¡Gracias ${userData.name}! ✅\n\nHe registrado tu correo: ${email}\n\n¿En qué más puedo ayudarte?`;
    }
  }

  /**
   * Procesa mensajes que llegaron mientras el bot estaba desconectado
   */
  async processPendingMessages() {
    try {
      console.log(
        "[PendingMessages] 🔍 Buscando chats con mensajes no leídos..."
      );

      let processedCount = 0;
      let errorCount = 0;
      let checkedChats = 0;

      try {
        // Obtener usuarios de las sesiones activas en la base de datos
        const activeSessions = await database.query(
          'SELECT user_id, chat_id, last_activity FROM user_sessions WHERE last_activity > DATE_SUB(NOW(), INTERVAL 7 DAY) AND chat_id IS NOT NULL'
        );

        console.log(
          `[PendingMessages] 📊 Verificando ${activeSessions.length} sesiones recientes...`
        );

        // Revisar cada sesión
        for (const session of activeSessions) {
          try {
            const chatId = session.chat_id;

            if (!chatId || chatId === 'null') continue;

            checkedChats++;

            // Obtener el chat
            const chat = await this.client.getChatById(chatId);

            // Obtener mensajes no leídos
            const unreadMessages = await chat.fetchMessages({ limit: 5 });

            if (!unreadMessages || unreadMessages.length === 0) continue;

            // Filtrar mensajes nuevos
            const lastActivity = new Date(session.last_activity).getTime();
            const newMessages = unreadMessages.filter(
              (msg) =>
                !msg.fromMe &&
                msg.timestamp * 1000 > lastActivity &&
                msg.body &&
                msg.body.trim() !== ""
            );

            if (newMessages.length > 0) {
              console.log(
                `[PendingMessages] 📬 Encontrados ${newMessages.length} mensajes nuevos en chat ${session.user_id}`
              );

              // Procesar cada mensaje nuevo
              for (const msg of newMessages) {
                try {
                  await this.processUnreadMessage(msg);
                  processedCount++;

                  await new Promise((resolve) => setTimeout(resolve, 1000));
                } catch (error) {
                  console.error(
                    `[PendingMessages] ❌ Error procesando mensaje:`,
                    error.message
                  );
                  errorCount++;
                }
              }
            }
          } catch (error) {
            if (error.message && !error.message.includes('404')) {
              console.log(
                `[PendingMessages] ⚠️ No se pudieron obtener mensajes de un chat: ${error.message}`
              );
            }
          }
        }

        if (checkedChats === 0) {
          console.log(
            "[PendingMessages] ℹ️ No hay sesiones recientes para verificar"
          );
        } else if (processedCount === 0) {
          console.log(
            `[PendingMessages] ℹ️ Se verificaron ${checkedChats} chats, no hay mensajes pendientes`
          );
        } else {
          console.log(
            `[PendingMessages] ✅ Procesados ${processedCount} mensajes pendientes de ${checkedChats} chats revisados`
          );
          await logger.log(
            "SYSTEM",
            `Procesados ${processedCount} mensajes pendientes al reconectarse`
          );
        }

        if (errorCount > 0) {
          console.log(
            `[PendingMessages] ⚠️ ${errorCount} mensajes con errores al procesar`
          );
        }
      } catch (dbError) {
        console.error(
          "[PendingMessages] ⚠️ Error consultando base de datos:",
          dbError.message
        );
      }
    } catch (error) {
      console.error(
        "[PendingMessages] ❌ Error general procesando mensajes pendientes:",
        error.message
      );
    }
  }

  /**
   * Procesa un mensaje no leído individual
   */
  async processUnreadMessage(msg) {
    const from = msg.from;
    const userId = from.replace("@c.us", "");
    const contact = await msg.getContact();
    const userName = contact.pushname || contact.name || userId;
    const chatId = from;
    const conversation = msg.body;

    if (!conversation || conversation.trim() === "") {
      return;
    }

    console.log(
      `[PendingMessages] 💬 Procesando mensaje de ${userName}: "${conversation.substring(
        0,
        50
      )}..."`
    );

    // Verificar si está en modo humano o soporte
    const isHuman = await humanModeManager.isHumanMode(userId);
    const isSupport = await humanModeManager.isSupportMode(userId);

    if (isHuman || isSupport) {
      console.log(
        `[PendingMessages] ⚠️ Usuario ${userId} en modo ${
          isSupport ? "SOPORTE" : "HUMANO"
        }, no se responde automáticamente`
      );
      await sessionManager.addMessage(userId, "user", conversation, chatId);
      await logger.log("USER", conversation, userId, userName);
      return;
    }

    await logger.log("USER", conversation, userId, userName);

    // Procesar mensaje
    const response = await this.processMessage(userId, conversation, chatId);

    // Enviar respuesta
    try {
      const chat = await msg.getChat();
      await chat.sendStateTyping();
      await new Promise(resolve => setTimeout(resolve, 300));

      await msg.reply(response);
      console.log(`[PendingMessages] ✅ Respuesta enviada a ${userName}`);
    } catch (sendError) {
      console.error(`[PendingMessages] ❌ Error enviando mensaje a ${userId}:`, sendError.message);
      throw sendError;
    }

    await logger.log("BOT", response, userId);
  }
}

module.exports = WhatsAppBot;
