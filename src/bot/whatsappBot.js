const makeWASocket = require("@whiskeysockets/baileys").default;
const {
  DisconnectReason,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const pino = require("pino");
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
const mediaService = require("../services/mediaService");
const contactsService = require("../services/contactsService");

class WhatsAppBot {
  constructor() {
    this.sock = null;
    this.systemPrompt = promptLoader.getPrompt();
    this.store = null;
    this.currentQR = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 3;
    this.isReconnecting = false;
  }

  async start() {
    if (this.isReconnecting) {
      console.log("Ya hay un intento de reconexión en progreso...");
      return;
    }

    this.isReconnecting = true;
    console.log("Iniciando bot de WhatsApp con Baileys (@whiskeysockets/baileys)...");
    config.validateApiKey();

    try {
      // Configurar autenticación multi-archivo
      const { state, saveCreds } = await useMultiFileAuthState(
        "./auth_baileys"
      );

      // Obtener versión más reciente de Baileys
      const { version, isLatest } = await fetchLatestBaileysVersion();
      console.log(
        `Usando versión de WhatsApp Web: ${version.join(
          "."
        )} (última: ${isLatest})`
      );

      // Crear socket de WhatsApp con configuración mejorada para producción
      this.sock = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(
            state.keys,
            pino({ level: "silent" })
          ),
        },
        printQRInTerminal: false,
        logger: pino({ level: "silent" }),
        browser: ["Chrome (Linux)", "", ""],
        generateHighQualityLinkPreview: false,
        syncFullHistory: false,
        getMessage: async (key) => {
          return undefined;
        },
        defaultQueryTimeoutMs: undefined,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 30000,
        qrTimeout: undefined,
        markOnlineOnConnect: false,
        msgRetryCounterCache: new Map(),
        retryRequestDelayMs: 250,
        maxMsgRetryCount: 5,
      });

      // Guardar credenciales cuando se actualicen
      this.sock.ev.on("creds.update", saveCreds);

      // Manejar actualizaciones de conexión
      this.sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          console.log("Escanea este código QR con WhatsApp:");
          console.log("O visita: http://tu-servidor:4242/qr");
          this.currentQR = qr;
          qrcode.generate(qr, { small: true });
        }

        if (connection === "close") {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
          console.log(
            "Conexión cerrada debido a",
            lastDisconnect?.error,
            ", reconectando:",
            shouldReconnect
          );

          // Si es error 405 o 401, limpiar sesión y reiniciar con límite
          if (statusCode === 405 || statusCode === 401 || statusCode === 403) {
            this.reconnectAttempts++;

            if (this.reconnectAttempts > this.maxReconnectAttempts) {
              console.log(
                "❌ Máximo de intentos de reconexión alcanzado. Por favor usa el botón de reiniciar sesión en /qr"
              );
              this.isReconnecting = false;
              return;
            }

            console.log(
              `Error ${statusCode} detectado. Intento ${this.reconnectAttempts}/${this.maxReconnectAttempts}. Limpiando sesión...`
            );
            this.clearSession();

            this.isReconnecting = false;
            setTimeout(() => this.start(), 5000);
          } else if (
            shouldReconnect &&
            statusCode !== DisconnectReason.loggedOut
          ) {
            this.reconnectAttempts = 0;
            this.isReconnecting = false;
            setTimeout(() => this.start(), 5000);
          } else {
            this.isReconnecting = false;
          }
        } else if (connection === "open") {
          console.log("¡Bot de WhatsApp conectado y listo!");
          this.currentQR = null;
          this.reconnectAttempts = 0;
          this.isReconnecting = false;
          logger.log("SYSTEM", "Bot iniciado correctamente con Baileys");

          // Procesar mensajes que llegaron mientras el bot estaba desconectado
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
          }, 3000); // Esperar 3 segundos para que el bot se estabilice

          // Inicializar follow-up manager
          followUpManager.initialize().then(() => {
            followUpManager.startFollowUpTimer(
              this.sock,
              aiService,
              sessionManager
            );
          });

          // Iniciar timer de limpieza de sesiones con referencia al followUpManager
          sessionManager.startCleanupTimer(this.sock, followUpManager);
        }
      });
    } catch (error) {
      console.error("Error iniciando bot:", error);
      this.isReconnecting = false;

      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        console.log(
          `Reintentando en 5 segundos... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`
        );
        setTimeout(() => this.start(), 5000);
      }
    }

    // Manejar mensajes entrantes
    this.sock.ev.on("messages.upsert", async (m) => {
      try {
        const msg = m.messages[0];
        if (!msg.message) return;

        // Log para debugging
        console.log(
          "Mensaje recibido - fromMe:",
          msg.key.fromMe,
          "remoteJid:",
          msg.key.remoteJid
        );

        // Ignorar mensajes propios
        if (msg.key.fromMe) {
          console.log("Ignorando mensaje propio");
          return;
        }

        // Obtener el número del remitente
        const from = msg.key.remoteJid;
        const isGroup = from.endsWith("@g.us");

        // Solo responder a mensajes privados
        if (isGroup) return;

        // Obtener el texto del mensaje
        const conversation =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          "";

        // Ignorar mensajes sin texto
        if (!conversation || conversation.trim() === "") {
          console.log("Mensaje ignorado - Sin contenido de texto");
          return;
        }

        // Extraer información del usuario
        const userId = from.replace("@s.whatsapp.net", "");
        const userName = msg.pushName || userId;

        // Implementar un sistema de debounce para evitar procesamiento duplicado
        if (!this.messageProcessingQueue) {
          this.messageProcessingQueue = new Map();
        }

        // Crear clave única para el mensaje
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

          // Detener seguimiento si está activo (ya está en conversación activa)
          if (await followUpManager.isFollowUpActive(userId)) {
            await followUpManager.stopFollowUp(userId, "modo_humano_activo");
          }

          return;
        }

        // Procesar mensaje y generar respuesta
        const response = await this.processMessage(userId, conversation, from);

        // Enviar respuesta solo si tenemos una respuesta válida
        if (response && response.trim() !== "") {
          try {
            // Verificar si el contacto existe antes de enviar
            try {
              await this.sock.onWhatsApp(userId + '@s.whatsapp.net');
            } catch (presenceError) {
              console.log(`[WhatsApp] ⚠️ No se pudo verificar presencia de ${userId}, intentando enviar de todos modos...`);
            }

            // Enviar estado de "escribiendo" antes del mensaje
            try {
              await this.sock.sendPresenceUpdate('composing', from);
              await new Promise(resolve => setTimeout(resolve, 300));
            } catch (presenceErr) {
              // Ignorar errores de presencia
            }

            // Enviar mensaje
            const sendResult = await this.sock.sendMessage(from, {
              text: response
            }, {
              // Opciones adicionales para mejorar la entrega
              cachedGroupMetadata: undefined
            });

            console.log(`[WhatsApp] ✅ Mensaje enviado exitosamente a ${userId}`);
            console.log(`[WhatsApp] ID del mensaje: ${sendResult?.key?.id}`);
            console.log(`[WhatsApp] Chat ID: ${from}`);
            console.log(`[WhatsApp] Status del mensaje:`, sendResult?.status || 'enviado');

            // Enviar estado de "disponible" después del mensaje
            try {
              await this.sock.sendPresenceUpdate('available', from);
            } catch (presenceErr) {
              // Ignorar errores de presencia
            }

            await logger.log("bot", response, userId, userName);

            // Enviar medios pendientes si los hay
            if (this._pendingMedia && this._pendingMedia.chatId === from) {
              const pendingIds = this._pendingMedia.mediaIds;
              this._pendingMedia = null;
              console.log(`[Media] Enviando ${pendingIds.length} medio(s) a ${userId}`);
              await this.sendMedia(from, pendingIds);
              await logger.log("SYSTEM", `Medios enviados: IDs ${pendingIds.join(',')}`, userId);
            }
          } catch (sendError) {
            console.error(`[WhatsApp] ❌ Error enviando mensaje a ${userId}:`, sendError);
            console.error(`[WhatsApp] Chat ID que falló: ${from}`);
            console.error(`[WhatsApp] Tipo de error:`, sendError.message);
            console.error(`[WhatsApp] Stack trace:`, sendError.stack);
            // Re-lanzar el error para que se maneje en el catch principal
            throw sendError;
          }
        }

        // Analizar estado de la conversación después de la respuesta
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
          // Detener seguimiento si existe
          if (await followUpManager.isFollowUpActive(userId)) {
            await followUpManager.stopFollowUp(userId, status.toLowerCase());
          }
        } else if (status === "ACTIVO") {
          // Cliente respondió - detener seguimiento si existe
          if (await followUpManager.isFollowUpActive(userId)) {
            await followUpManager.stopFollowUp(userId, "volvio_activo");
          }
          // NO iniciar seguimiento aquí - se iniciará automáticamente a los 5 minutos por sessionManager
        }
        // NO manejamos INACTIVO aquí - el sessionManager lo hace a los 5 minutos

        // Eliminar del queue después de procesar
        this.messageProcessingQueue.delete(messageKey);
      } catch (error) {
        await this.handleError(error, m.messages[0]);
      }
    });
  }

  async processMessage(userId, userMessage, chatId) {
    const dataCollectionState = userDataManager.getDataCollectionState(userId);

    // Verificar si estamos esperando el email para activar soporte (prioridad alta)
    if (dataCollectionState === "email_pending_for_support") {
      return await this.handleEmailCollection(userId, userMessage, chatId);
    }

    // Si es usuario nuevo, checar si ya lo conocemos en la tabla de contactos
    if (dataCollectionState === "none") {
      const knownContact = await contactsService.getByPhone(userId);

      if (knownContact && knownContact.name) {
        // Ya lo conocemos, restaurar sus datos en userDataManager
        console.log(`[Bot] Contacto conocido detectado: ${knownContact.name} (${userId})`);
        await userDataManager.setUserData(userId, {
          name: knownContact.name,
          email: knownContact.email || undefined,
          nameCollected: true,
          dataCollected: !!(knownContact.name && knownContact.email),
        });

        // Continuar con el flujo normal (no pedir nombre)
      } else {
        // Usuario realmente nuevo
        await userDataManager.setUserData(userId, {});

        // Agregar el mensaje del usuario primero
        await sessionManager.addMessage(userId, "user", userMessage, chatId);

        // Dar bienvenida y pedir nombre de forma educada
        const welcomeMessage = `¡Hola! Soy Daniel, asistente virtual de Navetec.\n\n¿Con quién tengo el gusto?\n\n_Por favor, proporciona tu nombre completo`;
        await sessionManager.addMessage(
          userId,
          "assistant",
          welcomeMessage,
          chatId
        );
        return welcomeMessage;
      }
    }

    // Detectar si el usuario está proporcionando un email o nombre directamente
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const trimmedMessage = userMessage.trim();

    // Detectar email
    if (emailRegex.test(trimmedMessage.toLowerCase())) {
      const email = trimmedMessage.toLowerCase();
      await userDataManager.setUserData(userId, { email: email });
      const userData = await userDataManager.getUserData(userId);

      // Guardar en tabla de contactos permanente
      await contactsService.saveEmail(userId, email);

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

    // Obtener historial para análisis y detección de contexto
    let conversationHistory = await sessionManager.getMessages(userId, chatId);

    // Detectar si es un nombre (después de que el bot lo haya pedido en la conversación)
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

        // Guardar en tabla de contactos permanente
        await contactsService.saveName(userId, trimmedMessage);

        // Agregar mensaje del usuario a la sesión
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

    // Actualizar historial después de agregar el mensaje
    conversationHistory = await sessionManager.getMessages(userId, chatId);

    // [SUSPENDIDO - Asesores de vacaciones por Semana Santa]
    // let asesorAsignado = null;
    // try {
    //   const analysis = await conversationAnalyzer.analyzeConversation(
    //     conversationHistory.map((msg) => ({
    //       type: msg.role === "user" ? "USER" : "BOT",
    //       message: msg.content,
    //     })),
    //     userId
    //   );
    //   asesorAsignado = analysis.asesor_asignado;
    //   console.log(
    //     `[Bot] Asesor asignado para ${userId}: ${asesorAsignado.nombre}`
    //   );
    // } catch (error) {
    //   console.error("[Bot] Error analizando conversación:", error);
    // }

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
      // Primero verificar si tenemos el email del usuario
      const userData = await userDataManager.getUserData(userId);
      if (!userData || !userData.email) {
        // Si no tenemos email, solicitarlo antes de activar soporte
        const cleanResponse = aiResponse
          .replace("{{ACTIVAR_SOPORTE}}", "")
          .trim();

        // Solo agregar la respuesta limpia si tiene contenido
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

      // Si ya tenemos el email, continuar con la activación del soporte
      // Remover el marcador de la respuesta
      const cleanResponse = aiResponse
        .replace("{{ACTIVAR_SOPORTE}}", "")
        .trim();

      // Activar modo soporte
      await humanModeManager.setMode(userId, "support");
      await sessionManager.updateSessionMode(userId, chatId, "support");

      let finalResponse = cleanResponse;
      // [SUSPENDIDO - Asesores de vacaciones por Semana Santa]
      // if (asesorAsignado) {
      //   finalResponse +=
      //     `\n\n📋 *Asesor asignado:* ${asesorAsignado.nombre}\n` +
      //     `_Especialidad: ${asesorAsignado.especialidades.join(", ")}_`;
      // }

      await sessionManager.addMessage(
        userId,
        "assistant",
        finalResponse,
        chatId
      );

      await logger.log("SYSTEM", `Modo SOPORTE activado para ${userId}`);

      return finalResponse;
    }

    // Verificar si la respuesta contiene marcador de medios
    const { cleanText: mediaCleanText, mediaIds } = this.parseMediaMarkers(aiResponse);
    if (mediaIds.length > 0) {
      await sessionManager.addMessage(userId, "assistant", mediaCleanText, chatId);
      // Guardar medios pendientes para enviar después del texto
      this._pendingMedia = { chatId, mediaIds };
      return mediaCleanText;
    }

    // Agregar respuesta de IA a la sesión
    await sessionManager.addMessage(userId, "assistant", aiResponse, chatId);

    return aiResponse;
  }

  async handleError(error, message) {
    console.error("Error procesando mensaje:", error);

    const from = message.key.remoteJid;
    const userId = from.replace("@s.whatsapp.net", "");

    let errorMessage = "Lo siento, ocurrió un error. Inténtalo de nuevo.";

    if (
      error.message.includes("autenticación") ||
      error.message.includes("API key")
    ) {
      errorMessage =
        "Error de configuración del bot. Por favor, contacta al administrador.";
    }

    try {
      await this.sock.sendMessage(from, { text: errorMessage });
      logger.log("ERROR", error.message, userId);
    } catch (sendError) {
      console.error("Error enviando mensaje de error:", sendError);
    }
  }

  async stop() {
    console.log("Cerrando bot...");
    if (this.sock) {
      this.sock.end();
    }
  }

  async clearSession() {
    const fs = require("fs").promises;
    const path = require("path");
    const authPath = path.join(process.cwd(), "auth_baileys");

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
      this.reconnectAttempts = 0;
      this.isReconnecting = false;

      if (this.sock) {
        try {
          await this.sock.logout();
        } catch (err) {
          console.log("Error al hacer logout:", err.message);
        }
      }

      await this.clearSession();

      // Reiniciar el bot para generar nuevo QR
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
      // Agregar el mensaje del usuario al historial antes de responder
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

    // Guardar en tabla de contactos permanente
    await contactsService.saveEmail(userId, email);

    // Verificar si había una activación de soporte pendiente
    if (await userDataManager.hasPendingSupportActivation(userId)) {
      // Limpiar el flag de soporte pendiente
      await userDataManager.setPendingSupportActivation(userId, false);

      // Activar modo soporte
      await humanModeManager.setMode(userId, "support");
      await sessionManager.updateSessionMode(userId, chatId, "support");

      // [SUSPENDIDO - Asesores de vacaciones por Semana Santa]
      // const conversationHistory = await sessionManager.getMessages(userId, chatId);
      // let asesorAsignado = null;
      // try {
      //   const analysis = await conversationAnalyzer.analyzeConversation(
      //     conversationHistory.map((msg) => ({
      //       type: msg.role === "user" ? "USER" : "BOT",
      //       message: msg.content,
      //     })),
      //     userId
      //   );
      //   asesorAsignado = analysis.asesor_asignado;
      // } catch (error) {
      //   console.error("[Bot] Error analizando conversación:", error);
      // }

      let response = `¡Perfecto ${userData.name}! ✅\n\nHe registrado tu correo: ${email}\n\nTe estoy transfiriendo con uno de nuestros asesores especializados que te ayudará con tu caso.`;

      // [SUSPENDIDO - Asesores de vacaciones por Semana Santa]
      // if (asesorAsignado) {
      //   response +=
      //     `\n\n📋 *Asesor asignado:* ${asesorAsignado.nombre}\n` +
      //     `_Especialidad: ${asesorAsignado.especialidades.join(", ")}_`;
      // }

      await logger.log("SYSTEM", `Modo SOPORTE activado para ${userId}`);

      // Agregar respuesta al historial
      await sessionManager.addMessage(userId, "assistant", response, chatId);

      return response;
    } else {
      // Solo confirmación de email sin activar soporte
      return `¡Gracias ${userData.name}! ✅\n\nHe registrado tu correo: ${email}\n\n¿En qué más puedo ayudarte?`;
    }
  }

  /**
   * Extrae IDs de medios del marcador {{ENVIAR_MEDIA:id1,id2}} o {{ENVIAR_IMAGEN:id1,id2}}
   * y retorna texto limpio + IDs
   */
  parseMediaMarkers(text) {
    const regex = /\{\{ENVIAR_(?:MEDIA|IMAGEN):([\d,]+)\}\}/g;
    const mediaIds = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
      const ids = match[1].split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
      mediaIds.push(...ids);
    }
    const cleanText = text.replace(regex, '').trim();
    return { cleanText, mediaIds };
  }

  /**
   * Envía medios (imágenes, videos, documentos) de la galería al chat de WhatsApp
   */
  async sendMedia(chatId, mediaIds) {
    const fs = require('fs').promises;
    const path = require('path');

    for (const id of mediaIds) {
      try {
        const media = await mediaService.getById(id);
        if (!media) {
          console.log(`[Media] Medio ID ${id} no encontrado, omitiendo`);
          continue;
        }

        const mediaPath = path.join(process.cwd(), media.file_path);
        const mediaBuffer = await fs.readFile(mediaPath);

        let messagePayload;
        const mediaType = media.media_type || 'image';

        switch (mediaType) {
          case 'video':
            messagePayload = {
              video: mediaBuffer,
              caption: media.title,
              mimetype: media.mime_type
            };
            break;
          case 'document':
            messagePayload = {
              document: mediaBuffer,
              mimetype: media.mime_type,
              fileName: media.original_filename || media.title,
              caption: media.title
            };
            break;
          case 'image':
          default:
            messagePayload = {
              image: mediaBuffer,
              caption: media.title,
              mimetype: media.mime_type
            };
            break;
        }

        await this.sock.sendMessage(chatId, messagePayload);
        console.log(`[Media] ✅ ${mediaType} enviado: ${media.title} (ID: ${id})`);

        // Pausa entre medios para evitar rate limiting
        if (mediaIds.indexOf(id) < mediaIds.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (error) {
        console.error(`[Media] ❌ Error enviando medio ID ${id}:`, error.message);
      }
    }
  }

  /**
   * Procesa mensajes que llegaron mientras el bot estaba desconectado
   * Se ejecuta automáticamente al conectarse el bot
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

        // Revisar cada sesión para ver si hay mensajes nuevos
        for (const session of activeSessions) {
          try {
            const chatId = session.chat_id;

            if (!chatId || chatId === 'null') continue;

            checkedChats++;

            // Intentar obtener los últimos 5 mensajes del chat
            const messages = await this.sock.fetchMessagesFromWA(chatId, 5);

            if (!messages || messages.length === 0) continue;

            // Filtrar mensajes que:
            // 1. No son nuestros (fromMe = false)
            // 2. Son más recientes que la última actividad registrada
            // 3. Tienen contenido de texto
            const lastActivity = new Date(session.last_activity).getTime();
            const newMessages = messages.filter(
              (msg) =>
                !msg.key.fromMe &&
                msg.messageTimestamp * 1000 > lastActivity &&
                msg.message &&
                (msg.message.conversation ||
                  msg.message.extendedTextMessage?.text)
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

                  // Pequeña pausa entre mensajes
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
            // Error obteniendo mensajes de un chat específico, continuar con el siguiente
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
        console.log(
          "[PendingMessages] ℹ️ El bot procesará mensajes normalmente cuando lleguen nuevos"
        );
      }
    } catch (error) {
      console.error(
        "[PendingMessages] ❌ Error general procesando mensajes pendientes:",
        error.message
      );
      console.log(
        "[PendingMessages] ℹ️ El bot continuará funcionando normalmente para mensajes nuevos"
      );
    }
  }

  /**
   * Procesa un mensaje no leído individual
   * @param {Object} msg - Mensaje de WhatsApp
   */
  async processUnreadMessage(msg) {
    const from = msg.key.remoteJid;
    const userId = from.replace("@s.whatsapp.net", "");
    const userName = msg.pushName || userId;
    const chatId = from;

    // Obtener el texto del mensaje
    const conversation =
      msg.message.conversation || msg.message.extendedTextMessage?.text || "";

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
      // Guardar el mensaje en el historial pero no responder
      await sessionManager.addMessage(userId, "user", conversation, chatId);
      await logger.log("USER", conversation, userId, userName);
      return;
    }

    // Agregar mensaje al log
    await logger.log("USER", conversation, userId, userName);

    // Generar respuesta con IA
    const aiResponse = await this.processMessage(
      userId,
      conversation,
      chatId
    );

    // Enviar respuesta
    try {
      // Enviar estado de "escribiendo"
      try {
        await this.sock.sendPresenceUpdate('composing', from);
        await new Promise(resolve => setTimeout(resolve, 300));
      } catch (presenceErr) {
        // Ignorar errores de presencia
      }

      const sendResult = await this.sock.sendMessage(from, { text: aiResponse });
      console.log(`[PendingMessages] ✅ Respuesta enviada a ${userName}`);
      console.log(`[PendingMessages] ID del mensaje: ${sendResult?.key?.id}`);
      console.log(`[PendingMessages] Status: ${sendResult?.status || 'enviado'}`);

      // Enviar medios pendientes si los hay
      if (this._pendingMedia && this._pendingMedia.chatId === from) {
        const pendingIds = this._pendingMedia.mediaIds;
        this._pendingMedia = null;
        console.log(`[PendingMessages] [Media] Enviando ${pendingIds.length} medio(s) a ${userId}`);
        await this.sendMedia(from, pendingIds);
      }

      // Enviar estado de "disponible"
      try {
        await this.sock.sendPresenceUpdate('available', from);
      } catch (presenceErr) {
        // Ignorar errores de presencia
      }
    } catch (sendError) {
      console.error(`[PendingMessages] ❌ Error enviando mensaje a ${userId}:`, sendError.message);
      throw sendError;
    }

    // Registrar respuesta en logs
    await logger.log("BOT", aiResponse, userId);
  }
}

module.exports = WhatsAppBot;
