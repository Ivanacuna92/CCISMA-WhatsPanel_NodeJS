import { useState } from 'react';
import { Upload, CheckCircle, XCircle, AlertCircle, Download } from 'lucide-react';
import voicebotApi from '../../services/voicebotApi';

function CampaignCreate({ onCampaignCreated }) {
    const [campaignName, setCampaignName] = useState('');
    const [file, setFile] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [dragActive, setDragActive] = useState(false);
    const [status, setStatus] = useState(null);

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
            setFile(e.dataTransfer.files[0]);
        }
    };

    const handleFileInput = (e) => {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0]);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!campaignName.trim()) {
            setStatus({ type: 'error', message: 'El nombre de la campaña es requerido' });
            return;
        }

        if (!file) {
            setStatus({ type: 'error', message: 'Debes seleccionar un archivo CSV' });
            return;
        }

        setUploading(true);
        setStatus(null);

        try {
            const result = await voicebotApi.createCampaign(campaignName, file);

            // Verificar si hay contactos rechazados
            if (result.rejectedContacts && result.rejectedContacts.length > 0) {
                setStatus({
                    type: 'warning',
                    message: `Campaña creada con ${result.contactsAdded} contactos.`,
                    rejectedContacts: result.rejectedContacts
                });
            } else {
                setStatus({
                    type: 'success',
                    message: `Campaña creada exitosamente. ${result.contactsAdded} contactos agregados.`
                });
            }

            // Resetear formulario
            setCampaignName('');
            setFile(null);

            // Solo redirigir automáticamente si NO hay contactos rechazados
            if (!result.rejectedContacts || result.rejectedContacts.length === 0) {
                setTimeout(() => {
                    onCampaignCreated();
                }, 1500);
            }
            // Si hay rechazados, el usuario debe dar clic en el botón para continuar
        } catch (error) {
            console.error('Error creando campaña:', error);
            setStatus({
                type: 'error',
                message: error.response?.data?.error || 'Error creando campaña'
            });
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className="max-w-4xl mx-auto">
            <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-2xl font-bold mb-6 text-gray-800">Crear Nueva Campaña de Voicebot</h2>

                <form onSubmit={handleSubmit}>
                    {/* Nombre de campaña */}
                    <div className="mb-6">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Nombre de la Campaña
                        </label>
                        <input
                            type="text"
                            value={campaignName}
                            onChange={(e) => setCampaignName(e.target.value)}
                            placeholder="Ej: Campaña Naves Industriales Enero 2025"
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-navetec-primary focus:border-transparent"
                            disabled={uploading}
                        />
                    </div>

                    {/* Upload CSV */}
                    <div className="mb-6">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Archivo CSV con Contactos
                        </label>

                        <div
                            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                                dragActive ? 'border-navetec-primary bg-blue-50' : 'border-gray-300'
                            } ${uploading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                            onDragEnter={handleDrag}
                            onDragLeave={handleDrag}
                            onDragOver={handleDrag}
                            onDrop={handleDrop}
                        >
                            {file ? (
                                <div className="flex items-center justify-center space-x-2">
                                    <CheckCircle className="h-6 w-6 text-green-500" />
                                    <span className="text-gray-700">{file.name}</span>
                                    <button
                                        type="button"
                                        onClick={() => setFile(null)}
                                        className="text-red-500 hover:text-red-700"
                                        disabled={uploading}
                                    >
                                        <XCircle className="h-5 w-5" />
                                    </button>
                                </div>
                            ) : (
                                <>
                                    <Upload className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                                    <p className="text-lg mb-2">Arrastra y suelta tu archivo CSV aquí</p>
                                    <p className="text-sm text-gray-500 mb-4">o</p>

                                    <label className="inline-block">
                                        <input
                                            type="file"
                                            accept=".csv"
                                            onChange={handleFileInput}
                                            className="hidden"
                                            disabled={uploading}
                                        />
                                        <span className="px-4 py-2 bg-navetec-primary text-white rounded hover:bg-navetec-dark cursor-pointer inline-block">
                                            Seleccionar archivo CSV
                                        </span>
                                    </label>
                                </>
                            )}
                        </div>

                        <div className="mt-4 p-4 bg-blue-50 rounded-lg">
                            <div className="flex items-start justify-between">
                                <div className="flex-1">
                                    <h4 className="font-semibold text-sm text-blue-900 mb-2">Formato del CSV:</h4>
                                    <p className="text-xs text-blue-800">
                                        <strong>Columnas:</strong> Teléfono, Nombre, Tipo de Nave, Ubicación, Tamaño (m2), Precio (MXN), Info Adicional, Ventajas
                                    </p>
                                    <p className="text-xs text-blue-700 mt-1">
                                        • Teléfono: 10 dígitos sin prefijo (ej: 7771234567)<br/>
                                        • Tamaño: solo el número (ej: 500)<br/>
                                        • Precio: solo el número (ej: 3500000)
                                    </p>
                                </div>
                                <a
                                    href="/api/voicebot/campaigns/template"
                                    download
                                    className="ml-4 px-4 py-2 bg-white border-2 border-blue-500 text-blue-600 rounded-lg hover:bg-blue-50 flex items-center text-sm font-semibold whitespace-nowrap"
                                >
                                    <Download className="h-4 w-4 mr-2" />
                                    Descargar Plantilla
                                </a>
                            </div>
                        </div>
                    </div>

                    {/* Estado */}
                    {status && (
                        <div className={`mb-6 p-4 rounded-lg ${
                            status.type === 'success' ? 'bg-green-100 text-green-700' :
                            status.type === 'warning' ? 'bg-yellow-100 text-yellow-800' :
                            'bg-red-100 text-red-700'
                        }`}>
                            <div className="flex items-start">
                                {status.type === 'success' ?
                                    <CheckCircle className="h-5 w-5 mr-2 flex-shrink-0 mt-0.5" /> :
                                    <AlertCircle className="h-5 w-5 mr-2 flex-shrink-0 mt-0.5" />
                                }
                                <div className="flex-1">
                                    <p className="text-sm font-medium">{status.message}</p>

                                    {/* Mostrar contactos rechazados */}
                                    {status.rejectedContacts && status.rejectedContacts.length > 0 && (
                                        <div className="mt-3">
                                            <p className="text-sm font-semibold mb-2">
                                                Contactos rechazados por datos incompletos:
                                            </p>
                                            <ul className="text-sm space-y-1 max-h-40 overflow-y-auto">
                                                {status.rejectedContacts.map((contact, index) => (
                                                    <li key={index} className="bg-yellow-50 p-2 rounded border border-yellow-200">
                                                        <span className="font-medium">{contact.name}</span>
                                                        {contact.phone && <span className="text-yellow-600"> ({contact.phone})</span>}
                                                        <br />
                                                        <span className="text-xs text-yellow-700">
                                                            Faltan: {contact.missingFields.join(', ')}
                                                        </span>
                                                    </li>
                                                ))}
                                            </ul>
                                            <button
                                                type="button"
                                                onClick={onCampaignCreated}
                                                className="mt-4 px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 text-sm font-medium"
                                            >
                                                Entendido, ir al listado de campañas
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Botón Submit */}
                    <div className="flex justify-end">
                        <button
                            type="submit"
                            disabled={uploading || !campaignName || !file}
                            className="px-6 py-3 bg-navetec-primary text-white rounded-lg font-semibold hover:bg-navetec-dark disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                        >
                            {uploading ? (
                                <>
                                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                                    Creando Campaña...
                                </>
                            ) : (
                                <>
                                    <Upload className="h-5 w-5 mr-2" />
                                    Crear Campaña
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

export default CampaignCreate;
