const userDataManager = require('./src/services/userDataManager');

async function clearUserData(userId) {
    try {
        console.log(`🔄 Eliminando datos personales para usuario: ${userId}\n`);

        // Verificar si el usuario existe
        const userData = await userDataManager.getUserData(userId);

        if (!userData) {
            console.log(`   ℹ️  No se encontraron datos para el usuario ${userId}\n`);
            process.exit(0);
        }

        console.log('Datos actuales:');
        console.log(`   - Nombre: ${userData.name || 'No disponible'}`);
        console.log(`   - Correo: ${userData.email || 'No disponible'}`);
        console.log(`   - Creado: ${userData.createdAt || 'No disponible'}\n`);

        // Eliminar datos del usuario
        await userDataManager.deleteUserData(userId);

        console.log('✅ Datos personales eliminados exitosamente');
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
