const database = require('./database');

class ContactsService {
    /**
     * Busca un contacto por número de teléfono
     */
    async getByPhone(phone) {
        try {
            return await database.findOne('contacts', 'phone = ?', [phone]);
        } catch (error) {
            console.error('[Contacts] Error obteniendo contacto:', error);
            return null;
        }
    }

    /**
     * Guarda o actualiza nombre de un contacto
     */
    async saveName(phone, name) {
        try {
            const existing = await this.getByPhone(phone);
            if (existing) {
                await database.query(
                    'UPDATE contacts SET name = ?, updated_at = NOW() WHERE phone = ?',
                    [name, phone]
                );
            } else {
                await database.insert('contacts', { phone, name });
            }
            console.log(`[Contacts] Nombre guardado para ${phone}: ${name}`);
        } catch (error) {
            console.error('[Contacts] Error guardando nombre:', error);
        }
    }

    /**
     * Guarda o actualiza email de un contacto
     */
    async saveEmail(phone, email) {
        try {
            const existing = await this.getByPhone(phone);
            if (existing) {
                await database.query(
                    'UPDATE contacts SET email = ?, updated_at = NOW() WHERE phone = ?',
                    [email, phone]
                );
            } else {
                await database.insert('contacts', { phone, email });
            }
            console.log(`[Contacts] Email guardado para ${phone}: ${email}`);
        } catch (error) {
            console.error('[Contacts] Error guardando email:', error);
        }
    }
}

module.exports = new ContactsService();
