const fs = require('fs').promises;
const path = require('path');
const database = require('./database');

function detectMediaType(mimeType) {
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    return 'document';
}

class MediaService {
    constructor() {
        this.mediaDir = path.join(process.cwd(), 'data', 'media');
        this.legacyImageDir = path.join(process.cwd(), 'data', 'images');
        this.ensureDirs();
    }

    async ensureDirs() {
        try {
            await fs.mkdir(this.mediaDir, { recursive: true });
            await fs.mkdir(this.legacyImageDir, { recursive: true });
        } catch (error) {
            console.error('Error creando directorios de medios:', error);
        }
    }

    async saveMedia(file, metadata) {
        try {
            const ext = path.extname(file.originalname).toLowerCase();
            const uniqueName = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}${ext}`;
            const filePath = path.join(this.mediaDir, uniqueName);

            await fs.writeFile(filePath, file.buffer);

            const mediaType = detectMediaType(file.mimetype);

            const id = await database.insert('gallery_images', {
                title: metadata.title,
                description: metadata.description || null,
                category: metadata.category,
                tags: metadata.tags || null,
                file_path: `data/media/${uniqueName}`,
                mime_type: file.mimetype,
                file_size: file.size,
                original_filename: file.originalname,
                media_type: mediaType,
                uploaded_by: metadata.uploadedBy || null
            });

            return {
                success: true,
                id,
                filename: uniqueName,
                title: metadata.title,
                category: metadata.category,
                media_type: mediaType
            };
        } catch (error) {
            console.error('Error guardando medio:', error);
            throw new Error('Error guardando medio: ' + error.message);
        }
    }

    // Backward compat
    async saveImage(file, metadata) {
        return this.saveMedia(file, metadata);
    }

    async getAll(mediaType = null) {
        try {
            if (mediaType) {
                return await database.findAll('gallery_images', 'media_type = ?', [mediaType], 'created_at DESC');
            }
            return await database.findAll('gallery_images', '1=1', [], 'created_at DESC');
        } catch (error) {
            console.error('Error obteniendo medios:', error);
            return [];
        }
    }

    async getById(id) {
        try {
            return await database.findOne('gallery_images', 'id = ?', [id]);
        } catch (error) {
            console.error('Error obteniendo medio:', error);
            return null;
        }
    }

    async getByCategory(category) {
        try {
            return await database.findAll('gallery_images', 'category = ?', [category], 'created_at DESC');
        } catch (error) {
            console.error('Error filtrando medios por categoria:', error);
            return [];
        }
    }

    async search(query) {
        try {
            const param = `%${query}%`;
            const sql = `SELECT * FROM gallery_images
                WHERE title LIKE ? OR description LIKE ? OR tags LIKE ? OR category LIKE ?
                ORDER BY created_at DESC`;
            return await database.query(sql, [param, param, param, param]);
        } catch (error) {
            console.error('Error buscando medios:', error);
            return [];
        }
    }

    async delete(id) {
        try {
            const media = await this.getById(id);
            if (!media) {
                throw new Error('Medio no encontrado');
            }

            const filePath = path.join(process.cwd(), media.file_path);
            try {
                await fs.unlink(filePath);
            } catch (err) {
                console.error('Error eliminando archivo de medio:', err.message);
            }

            await database.delete('gallery_images', 'id = ?', [id]);
            return { success: true, message: 'Medio eliminado' };
        } catch (error) {
            console.error('Error eliminando medio:', error);
            throw new Error('Error eliminando medio: ' + error.message);
        }
    }

    async getMediaSummaryForPrompt() {
        try {
            const items = await this.getAll();
            if (items.length === 0) return null;

            return items.map(item => {
                const mediaType = item.media_type || 'image';
                const typeLabel = mediaType === 'video' ? '[VIDEO]'
                    : mediaType === 'document' ? '[DOCUMENTO]'
                    : '[IMAGEN]';
                let line = `ID:${item.id} | ${typeLabel} ${item.title} | Categoria: ${item.category}`;
                if (item.description) {
                    line += ` | ${item.description}`;
                }
                if (item.tags) {
                    line += ` | Tags: ${item.tags}`;
                }
                return line;
            }).join('\n');
        } catch (error) {
            console.error('Error generando resumen de medios para prompt:', error);
            return null;
        }
    }

    // Backward compat
    async getImageSummaryForPrompt() {
        return this.getMediaSummaryForPrompt();
    }
}

module.exports = new MediaService();
