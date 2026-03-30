import { useState, useEffect } from 'react';
import { Upload, CheckCircle, XCircle, Trash2, Image, Filter, Film, FileText } from 'lucide-react';
import * as api from '../services/api';

const CATEGORIES = [
  { value: 'planos', label: 'Planos' },
  { value: 'avances', label: 'Avances de Obra' },
  { value: 'fotos', label: 'Fotos de Naves' },
  { value: 'renders', label: 'Renders' },
  { value: 'ubicacion', label: 'Ubicacion' },
  { value: 'fichas', label: 'Fichas Tecnicas' },
  { value: 'videos', label: 'Videos' },
  { value: 'otro', label: 'Otro' },
];

const MEDIA_TYPE_FILTERS = [
  { value: '', label: 'Todos los tipos' },
  { value: 'image', label: 'Imagenes' },
  { value: 'video', label: 'Videos' },
  { value: 'document', label: 'Documentos' },
];

const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/webm', 'video/quicktime',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
];

function getMediaTypeLabel(mediaType) {
  if (mediaType === 'video') return 'Video';
  if (mediaType === 'document') return 'Documento';
  return 'Imagen';
}

function getSelectedFileIcon(file) {
  if (file.type.startsWith('video/')) return <Film className="h-8 w-8 text-blue-500" />;
  if (file.type === 'application/pdf' || file.type.startsWith('application/')) return <FileText className="h-8 w-8 text-red-500" />;
  return <Image className="h-8 w-8 text-navetec-primary" />;
}

function MediaGallery() {
  const [items, setItems] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [uploadStatus, setUploadStatus] = useState(null);
  const [filterCategory, setFilterCategory] = useState('');
  const [filterMediaType, setFilterMediaType] = useState('');

  // Form state
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('fotos');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);

  useEffect(() => {
    fetchMedia();
  }, [filterCategory, filterMediaType]);

  const fetchMedia = async () => {
    try {
      const response = await api.getMedia(filterCategory || null, filterMediaType || null);
      setItems(response.images || []);
    } catch (error) {
      console.error('Error fetching media:', error);
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
      if (ALLOWED_TYPES.includes(file.type)) {
        setSelectedFile(file);
      } else {
        setUploadStatus({ type: 'error', message: 'Tipo de archivo no permitido. Se aceptan imagenes, videos y PDFs.' });
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
      setUploadStatus({ type: 'error', message: 'Selecciona un archivo' });
      return;
    }
    if (!title.trim()) {
      setUploadStatus({ type: 'error', message: 'El titulo es requerido' });
      return;
    }

    setUploading(true);
    setUploadStatus(null);

    const formData = new FormData();
    formData.append('media', selectedFile);
    formData.append('title', title.trim());
    formData.append('category', category);
    formData.append('description', description.trim());
    formData.append('tags', tags.trim());

    try {
      await api.uploadMedia(formData);
      setUploadStatus({ type: 'success', message: 'Archivo subido exitosamente' });
      setTitle('');
      setDescription('');
      setTags('');
      setSelectedFile(null);
      setCategory('fotos');
      fetchMedia();
    } catch (error) {
      let errorMessage = 'Error al cargar el archivo';
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

  const handleDelete = async (id, itemTitle) => {
    if (!confirm(`Eliminar "${itemTitle}"?`)) return;

    try {
      await api.deleteMedia(id);
      setUploadStatus({ type: 'success', message: `"${itemTitle}" eliminado` });
      fetchMedia();
    } catch (error) {
      setUploadStatus({ type: 'error', message: 'Error al eliminar el archivo' });
    }
  };

  return (
    <div className="p-6 overflow-auto flex-1">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-2xl font-bold mb-6 text-gray-800">Galeria de Medios</h2>

        {/* Upload Section */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h3 className="text-lg font-semibold mb-4">Subir Archivo</h3>

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
                placeholder="Descripcion breve del archivo"
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
                {getSelectedFileIcon(selectedFile)}
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
                <p className="text-sm mb-2">Arrastra y suelta un archivo aqui</p>
                <p className="text-xs text-gray-500 mb-3">o</p>
                <label className="inline-block">
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/quicktime,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    onChange={handleFileInput}
                    className="hidden"
                    disabled={uploading}
                  />
                  <span className="px-4 py-2 bg-navetec-primary text-white rounded hover:bg-navetec-dark cursor-pointer inline-block text-sm">
                    Seleccionar archivo
                  </span>
                </label>
                <p className="text-xs text-gray-500 mt-3">Imagenes, videos o documentos - Max 50MB</p>
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
                  Subir Archivo
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
              Medios ({items.length})
            </h3>
            <div className="flex items-center gap-3">
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
              <select
                value={filterMediaType}
                onChange={(e) => setFilterMediaType(e.target.value)}
                className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-navetec-primary"
              >
                {MEDIA_TYPE_FILTERS.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
          </div>

          {items.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Image className="mx-auto h-12 w-12 text-gray-300 mb-3" />
              <p>No hay medios {filterCategory || filterMediaType ? 'con este filtro' : 'subidos aun'}</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {items.map(item => (
                <div key={item.id} className="bg-gray-50 rounded-lg overflow-hidden border hover:shadow-md transition-shadow">
                  {/* Preview area */}
                  {item.media_type === 'video' ? (
                    <div className="w-full h-40 bg-gray-800 flex items-center justify-center relative">
                      <Film className="h-12 w-12 text-white opacity-70" />
                      <span className="absolute bottom-2 right-2 bg-black bg-opacity-60 text-white text-xs px-2 py-0.5 rounded">
                        VIDEO
                      </span>
                    </div>
                  ) : item.media_type === 'document' ? (
                    <div className="w-full h-40 bg-red-50 flex flex-col items-center justify-center">
                      <FileText className="h-12 w-12 text-red-400" />
                      <span className="text-xs text-red-500 mt-1 font-medium">
                        {item.mime_type === 'application/pdf' ? 'PDF' : 'DOC'}
                      </span>
                    </div>
                  ) : (
                    <img
                      src={api.getMediaUrl(item.id)}
                      alt={item.title}
                      className="w-full h-40 object-cover"
                      loading="lazy"
                    />
                  )}

                  {/* Info area */}
                  <div className="p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                        item.media_type === 'video' ? 'bg-blue-100 text-blue-700' :
                        item.media_type === 'document' ? 'bg-red-100 text-red-700' :
                        'bg-green-100 text-green-700'
                      }`}>
                        {getMediaTypeLabel(item.media_type)}
                      </span>
                    </div>
                    <p className="font-medium text-sm truncate" title={item.title}>{item.title}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {CATEGORIES.find(c => c.value === item.category)?.label || item.category}
                    </p>
                    {item.description && (
                      <p className="text-xs text-gray-400 mt-1 truncate" title={item.description}>{item.description}</p>
                    )}
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-xs text-gray-400">
                        ID: {item.id}
                      </span>
                      <button
                        onClick={() => handleDelete(item.id, item.title)}
                        className="text-red-400 hover:text-red-600 transition-colors"
                        title="Eliminar"
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

export default MediaGallery;
