const WhatsAppBot = require('./src/bot/whatsappBot');
const WebServer = require('./src/web/server');
const config = require('./src/config/config');
const databaseInit = require('./src/services/databaseInit');
const campaignManager = require('./src/services/voicebot/campaignManager');

// Crear instancia del bot
const bot = new WhatsAppBot();

// Exponer instancia del bot globalmente para el servidor web
global.whatsappBot = bot;

// Crear instancia del servidor web
const webServer = new WebServer(config.webPort);

// Iniciar bot y servidor web
async function start() {
    try {
        console.log('🚀 Iniciando aplicación...');

        // Inicializar base de datos
        console.log('📊 Inicializando base de datos...');
        await databaseInit.createTables();

        // Iniciar WhatsApp Bot
        console.log('💬 Iniciando WhatsApp Bot...');
        await bot.start();

        // Iniciar Campaign Manager (Voicebot)
        console.log('📞 Iniciando Voicebot Campaign Manager...');
        await campaignManager.initialize();

        // Iniciar servidor web
        console.log('🌐 Iniciando servidor web...');
        await webServer.start();

        console.log('✅ Aplicación iniciada correctamente');
    } catch (error) {
        console.error('❌ Error iniciando aplicación:', error);
        process.exit(1);
    }
}

start().catch(console.error);

// Manejar cierre limpio
process.on('SIGINT', async () => {
    console.log('\n⏹️  Cerrando aplicación...');

    try {
        await campaignManager.shutdown();
        await bot.stop();
    } catch (error) {
        console.error('Error en cierre:', error);
    }

    process.exit(0);
});