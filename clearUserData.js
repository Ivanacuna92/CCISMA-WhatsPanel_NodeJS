const userDataManager = require('./src/services/userDataManager');
const sessionManager = require('./src/services/sessionManager');
const database = require('./src/services/database');

async function clearUserData(userId) {
    try {
        console.log(`🔄 Eliminando datos personales para usuario: ${userId}\n`);

        // Esperar a que se carguen los datos
        await userDataManager.loadData();

        // Verificar si el usuario existe
        const userData = await userDataManager.getUserData(userId);

        if (!userData) {
            console.log(`   ℹ️  No se encontraron datos personales para el usuario ${userId}`);
        } else {
            console.log('Datos actuales:');
            console.log(`   - Nombre: ${userData.name || 'No disponible'}`);
            console.log(`   - Correo: ${userData.email || 'No disponible'}`);
            console.log(`   - Creado: ${userData.createdAt || 'No disponible'}\n`);
        }

        // 1. Eliminar datos personales del usuario
        console.log('1. Eliminando datos personales...');
        await userDataManager.deleteUserData(userId);
        console.log('   ✅ Datos personales eliminados\n');

        // 2. Limpiar sesión del cache local
        console.log('2. Limpiando sesión activa en memoria...');
        if (sessionManager.localCache && sessionManager.localCache.has(userId)) {
            sessionManager.localCache.delete(userId);
            console.log('   ✅ Sesión eliminada del cache\n');
        } else {
            console.log('   ℹ️  No hay sesión activa en cache\n');
        }

        // 3. Limpiar sesión de la base de datos
        console.log('3. Limpiando sesión de la base de datos...');
        try {
            await database.query('DELETE FROM user_sessions WHERE user_id = ?', [userId]);
            console.log('   ✅ Sesión eliminada de la base de datos\n');
        } catch (dbError) {
            console.log('   ℹ️  No se pudo limpiar la base de datos (puede no estar configurada)\n');
        }

        console.log('✅ Limpieza completa exitosa');
        console.log(`📝 El usuario ${userId} ahora es tratado como nuevo cliente\n`);

        process.exit(0);
    } catch (error) {
        console.error('❌ Error eliminando datos:', error);
        process.exit(1);
    }
}

// Verificar argumentos de línea de comandos
const args = process.argv.slice(2);

if (args.length === 0) {
    console.log('Uso:');
    console.log('  node clearUserData.js <userId>');
    console.log('  node clearUserData.js 5217711234567   # Ejemplo con número de teléfono');
    process.exit(0);
}

clearUserData(args[0]);
