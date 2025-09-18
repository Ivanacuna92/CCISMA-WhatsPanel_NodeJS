const sessionManager = require('./src/services/sessionManager');
const database = require('./src/services/database');
const humanModeManager = require('./src/services/humanModeManager');

async function resetAllAdvisors() {
    try {
        console.log('🔄 Iniciando reseteo de asignaciones de asesores...\n');

        // 1. Limpiar todas las sesiones del cache local
        console.log('1. Limpiando cache local de sesiones...');
        const sessionCache = sessionManager.localCache;
        const totalSessions = sessionCache.size;
        sessionCache.clear();
        console.log(`   ✅ ${totalSessions} sesiones eliminadas del cache local\n`);

        // 2. Limpiar todas las sesiones de la base de datos
        console.log('2. Limpiando sesiones de la base de datos...');
        const deleteSessionsResult = await database.query('DELETE FROM user_sessions');
        console.log(`   ✅ Sesiones eliminadas de la base de datos\n`);

        // 3. Limpiar todos los análisis de conversaciones
        console.log('3. Limpiando análisis de conversaciones...');
        const deleteAnalysisResult = await database.query('DELETE FROM conversation_analysis');
        console.log(`   ✅ Análisis de conversaciones eliminados\n`);

        // 4. Limpiar estados de modo humano
        console.log('4. Reseteando estados de modo humano...');
        // Obtener todos los contactos y resetearlos
        const allStates = await humanModeManager.getAllHumanStates();
        let resetCount = 0;
        for (const contactId of Object.keys(allStates)) {
            await humanModeManager.setMode(contactId, false);
            resetCount++;
        }
        // Limpiar el cache local
        humanModeManager.localCache.clear();
        console.log(`   ✅ ${resetCount} estados de modo humano reseteados\n`);

        console.log('✨ Reseteo completado exitosamente!');
        console.log('📝 Nota: Las nuevas conversaciones asignarán asesores automáticamente basándose en el contenido del mensaje.');

        process.exit(0);
    } catch (error) {
        console.error('❌ Error durante el reseteo:', error);
        process.exit(1);
    }
}

async function resetSpecificUser(userId) {
    try {
        console.log(`🔄 Reseteando asignaciones para usuario: ${userId}\n`);

        // 1. Limpiar sesión del cache local
        console.log('1. Limpiando cache local...');
        if (sessionManager.localCache.has(userId)) {
            sessionManager.localCache.delete(userId);
            console.log(`   ✅ Sesión eliminada del cache local\n`);
        } else {
            console.log(`   ℹ️  No se encontró sesión en cache local\n`);
        }

        // 2. Limpiar sesión de la base de datos
        console.log('2. Limpiando sesión de la base de datos...');
        await database.query('DELETE FROM user_sessions WHERE user_id = ?', [userId]);
        console.log(`   ✅ Sesión eliminada de la base de datos\n`);

        // 3. Limpiar análisis de conversaciones del usuario
        console.log('3. Limpiando análisis de conversaciones...');
        await database.query('DELETE FROM conversation_analysis WHERE user_id = ?', [userId]);
        console.log(`   ✅ Análisis de conversaciones eliminados\n`);

        // 4. Limpiar estado de modo humano
        console.log('4. Reseteando estado de modo humano...');
        await humanModeManager.setMode(userId, false);
        console.log(`   ✅ Estado de modo humano reseteado\n`);

        console.log('✨ Reseteo completado exitosamente!');
        console.log(`📝 La próxima conversación con ${userId} asignará un asesor automáticamente.`);

        process.exit(0);
    } catch (error) {
        console.error('❌ Error durante el reseteo:', error);
        process.exit(1);
    }
}

// Verificar argumentos de línea de comandos
const args = process.argv.slice(2);

if (args.length === 0) {
    console.log('Uso:');
    console.log('  node resetAdvisors.js --all                  # Resetea todos los usuarios');
    console.log('  node resetAdvisors.js --user <userId>        # Resetea un usuario específico');
    console.log('  node resetAdvisors.js --user 5217711234567   # Ejemplo con número de teléfono');
    process.exit(0);
}

if (args[0] === '--all') {
    resetAllAdvisors();
} else if (args[0] === '--user' && args[1]) {
    resetSpecificUser(args[1]);
} else {
    console.error('❌ Argumentos inválidos');
    console.log('Uso:');
    console.log('  node resetAdvisors.js --all                  # Resetea todos los usuarios');
    console.log('  node resetAdvisors.js --user <userId>        # Resetea un usuario específico');
    process.exit(1);
}