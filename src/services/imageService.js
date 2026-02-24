const fs = require('fs').promises;
const path = require('path');
const database = require('./database');

class ImageService {
    constructor() {
        this.imageDir = path.join(process.cwd(), 'data', 'images');
        this.ensureImageDir();
    }

    async ensureImageDir() {
        try {
            await fs.mkdir(this.imageDir, { recursive: true });
        } catch (error) {
            console.error('Error creando directorio de imágenes:', error);
        }
    }

    async saveImage(file, metadata) {
        try {
            // Generar nombre único
            const ext = path.extname(file.originalname).toLowerCase();
            const uniqueName = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}${ext}`;
            const filePath = path.join(this.imageDir, uniqueName);

            // Guardar archivo
            await fs.writeFile(filePath, file.buffer);

            // Insertar en BD
            const id = await database.insert('gallery_images', {
                title: metadata.title,
                description: metadata.description || null,
                category: metadata.category,
                tags: metadata.tags || null,
                file_path: `data/images/${uniqueName}`,
                mime_type: file.mimetype,
                file_size: file.size,
                original_filename: file.originalname,
                uploaded_by: metadata.uploadedBy || null
            });

            return {
                success: true,
                id,
                filename: uniqueName,
                title: metadata.title,
                category: metadata.category
            };
        } catch (error) {
            console.error('Error guardando imagen:', error);
            throw new Error('Error guardando imagen: ' + error.message);
        }
    }

    async getAll() {
        try {
            return await database.findAll('gallery_images', '1=1', [], 'created_at DESC');
        } catch (error) {
            console.error('Error obteniendo imágenes:', error);
            return [];
        }
    }

    async getById(id) {
        try {
            return await database.findOne('gallery_images', 'id = ?', [id]);
        } catch (error) {
            console.error('Error obteniendo imagen:', error);
            return null;
        }
    }

    async getByCategory(category) {
        try {
            return await database.findAll('gallery_images', 'category = ?', [category], 'created_at DESC');
        } catch (error) {
            console.error('Error filtrando imágenes por categoría:', error);
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
            console.error('Error buscando imágenes:', error);
            return [];
        }
    }

    async delete(id) {
        try {
            const image = await this.getById(id);
            if (!image) {
                throw new Error('Imagen no encontrada');
            }

            // Eliminar archivo físico
            const filePath = path.join(process.cwd(), image.file_path);
            try {
                await fs.unlink(filePath);
            } catch (err) {
                console.error('Error eliminando archivo de imagen:', err.message);
            }

            // Eliminar registro de BD
            await database.delete('gallery_images', 'id = ?', [id]);
            return { success: true, message: 'Imagen eliminada' };
        } catch (error) {
            console.error('Error eliminando imagen:', error);
            throw new Error('Error eliminando imagen: ' + error.message);
        }
    }

    async getImageSummaryForPrompt() {
        try {
            const images = await this.getAll();
            if (images.length === 0) return null;

            return images.map(img => {
                let line = `ID:${img.id} | ${img.title} | Categoria: ${img.category}`;
                if (img.description) {
                    line += ` | ${img.description}`;
                }
                if (img.tags) {
                    line += ` | Tags: ${img.tags}`;
                }
                return line;
            }).join('\n');
        } catch (error) {
            console.error('Error generando resumen de imágenes para prompt:', error);
            return null;
        }
    }
}

module.exports = new ImageService();
