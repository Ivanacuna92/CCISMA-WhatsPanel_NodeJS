import { useState, useEffect } from 'react';
import { Upload, CheckCircle, XCircle, Trash2, Image, Filter } from 'lucide-react';
import * as api from '../services/api';

const CATEGORIES = [
  { value: 'planos', label: 'Planos' },
  { value: 'avances', label: 'Avances de Obra' },
  { value: 'fotos', label: 'Fotos de Naves' },
  { value: 'renders', label: 'Renders' },
  { value: 'ubicacion', label: 'Ubicacion' },
  { value: 'otro', label: 'Otro' },
];

function ImageGallery() {
  const [images, setImages] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [uploadStatus, setUploadStatus] = useState(null);
  const [filterCategory, setFilterCategory] = useState('');

  // Form state
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('fotos');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);

  useEffect(() => {
    fetchImages();
  }, [filterCategory]);

  const fetchImages = async () => {
    try {
      const response = await api.getImages(filterCategory || null);
      setImages(response.images || []);
    } catch (error) {
      console.error('Error fetching images:', error);
    }
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.type.startsWith('image/')) {
        setSelectedFile(file);
      } else {
        setUploadStatus({ type: 'error', message: 'Solo se permiten archivos de imagen' });
      }
    }
  };

  const handleFileInput = (e) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      setUploadStatus({ type: 'error', message: 'Selecciona una imagen' });
      return;
    }
    if (!title.trim()) {
      setUploadStatus({ type: 'error', message: 'El titulo es requerido' });
      return;
    }

    setUploading(true);
    setUploadStatus(null);

    const formData = new FormData();
    formData.append('image', selectedFile);
    formData.append('title', title.trim());
    formData.append('category', category);
    formData.append('description', description.trim());
    formData.append('tags', tags.trim());

    try {
      await api.uploadImage(formData);
      setUploadStatus({ type: 'success', message: 'Imagen subida exitosamente' });
      // Reset form
      setTitle('');
      setDescription('');
      setTags('');
      setSelectedFile(null);
      setCategory('fotos');
      fetchImages();
    } catch (error) {
      let errorMessage = 'Error al cargar la imagen';
      if (error.response?.data?.error) {
        errorMessage = error.response.data.error;
      } else if (error.message) {
        errorMessage = error.message;
      }
      setUploadStatus({ type: 'error', message: errorMessage });
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id, imageTitle) => {
    if (!confirm(`Eliminar imagen "${imageTitle}"?`)) return;

    try {
      await api.deleteImage(id);
      setUploadStatus({ type: 'success', message: `Imagen "${imageTitle}" eliminada` });
      fetchImages();
    } catch (error) {
      setUploadStatus({ type: 'error', message: 'Error al eliminar la imagen' });
    }
  };

  return (
    <div className="p-6 overflow-auto flex-1">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-2xl font-bold mb-6 text-gray-800">Galeria de Imagenes</h2>

        {/* Upload Section */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h3 className="text-lg font-semibold mb-4">Subir Imagen</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Titulo *</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ej: PLANOS-MICRONAVE"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-navetec-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Categoria *</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-navetec-primary"
              >
                {CATEGORIES.map(cat => (
                  <option key={cat.value} value={cat.value}>{cat.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Descripcion</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Descripcion breve de la imagen"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-navetec-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tags (separados por coma)</label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="Ej: micronave, febrero, exterior"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-navetec-primary"
              />
            </div>
          </div>

          {/* Drag & Drop zone */}
          <div
            className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
              dragActive ? 'border-navetec-primary bg-blue-50' : 'border-gray-300'
            } ${uploading ? 'opacity-50 cursor-not-allowed' : ''}`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
          >
            {selectedFile ? (
              <div className="flex items-center justify-center gap-3">
                <Image className="h-8 w-8 text-navetec-primary" />
                <div className="text-left">
                  <p className="font-medium">{selectedFile.name}</p>
                  <p className="text-sm text-gray-500">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
                <button
                  onClick={() => setSelectedFile(null)}
                  className="text-red-500 hover:text-red-700 ml-2"
                >
                  <XCircle className="h-5 w-5" />
                </button>
              </div>
            ) : (
              <>
                <Upload className="mx-auto h-10 w-10 text-gray-400 mb-3" />
                <p className="text-sm mb-2">Arrastra y suelta una imagen aqui</p>
                <p className="text-xs text-gray-500 mb-3">o</p>
                <label className="inline-block">
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp"
                    onChange={handleFileInput}
                    className="hidden"
                    disabled={uploading}
                  />
                  <span className="px-4 py-2 bg-navetec-primary text-white rounded hover:bg-navetec-dark cursor-pointer inline-block text-sm">
                    Seleccionar imagen
                  </span>
                </label>
                <p className="text-xs text-gray-500 mt-3">JPEG, PNG, GIF, WEBP - Max 10MB</p>
              </>
            )}
          </div>

          {/* Upload button */}
          <div className="mt-4 flex justify-end">
            <button
              onClick={handleUpload}
              disabled={uploading || !selectedFile || !title.trim()}
              className="px-6 py-2 bg-navetec-primary text-white rounded-md hover:bg-navetec-dark disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {uploading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Subiendo...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4" />
                  Subir Imagen
                </>
              )}
            </button>
          </div>
        </div>

        {/* Status messages */}
        {uploadStatus && (
          <div className={`mb-6 p-4 rounded-lg ${
            uploadStatus.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
          }`}>
            <div className="flex items-center">
              {uploadStatus.type === 'success' ?
                <CheckCircle className="h-5 w-5 mr-2 flex-shrink-0" /> :
                <XCircle className="h-5 w-5 mr-2 flex-shrink-0" />
              }
              <span className="text-sm">{uploadStatus.message}</span>
            </div>
          </div>
        )}

        {/* Gallery Section */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">
              Imagenes ({images.length})
            </h3>
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-gray-500" />
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-navetec-primary"
              >
                <option value="">Todas las categorias</option>
                {CATEGORIES.map(cat => (
                  <option key={cat.value} value={cat.value}>{cat.label}</option>
                ))}
              </select>
            </div>
          </div>

          {images.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Image className="mx-auto h-12 w-12 text-gray-300 mb-3" />
              <p>No hay imagenes {filterCategory ? 'en esta categoria' : 'subidas aun'}</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {images.map(img => (
                <div key={img.id} className="bg-gray-50 rounded-lg overflow-hidden border hover:shadow-md transition-shadow">
                  <img
                    src={api.getImageUrl(img.id)}
                    alt={img.title}
                    className="w-full h-40 object-cover"
                    loading="lazy"
                  />
                  <div className="p-3">
                    <p className="font-medium text-sm truncate" title={img.title}>{img.title}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {CATEGORIES.find(c => c.value === img.category)?.label || img.category}
                    </p>
                    {img.description && (
                      <p className="text-xs text-gray-400 mt-1 truncate" title={img.description}>{img.description}</p>
                    )}
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-xs text-gray-400">
                        ID: {img.id}
                      </span>
                      <button
                        onClick={() => handleDelete(img.id, img.title)}
                        className="text-red-400 hover:text-red-600 transition-colors"
                        title="Eliminar imagen"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ImageGallery;
