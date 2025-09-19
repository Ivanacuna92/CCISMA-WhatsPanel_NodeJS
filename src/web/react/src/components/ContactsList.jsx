import React, { useEffect, useState } from 'react';
import { fetchContacts, toggleHumanMode } from '../services/api';

function ContactsList({ contacts, setContacts, selectedContact, onSelectContact }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadContacts();
    const interval = setInterval(loadContacts, 2000); // Actualizar cada 2 segundos para ver mensajes más rápido
    return () => clearInterval(interval);
  }, [selectedContact]);

  const loadContacts = async () => {
    try {
      const data = await fetchContacts();
      // console.log('[ContactsList] Loaded contacts:', data); // DEBUG
      setContacts(data);
      
      // Si hay un contacto seleccionado, actualizar sus mensajes
      if (selectedContact) {
        const updatedContact = data.find(c => c.phone === selectedContact.phone);
        if (updatedContact) {
          // Comparar la cantidad de mensajes o el último mensaje
          const hasNewMessages = 
            updatedContact.messages.length !== selectedContact.messages.length ||
            (updatedContact.messages.length > 0 && selectedContact.messages.length > 0 &&
             updatedContact.messages[updatedContact.messages.length - 1].timestamp !== 
             selectedContact.messages[selectedContact.messages.length - 1].timestamp);
          
          if (hasNewMessages) {
            // console.log('[ContactsList] Contact has new messages, updating:', updatedContact); // DEBUG
            onSelectContact(updatedContact);
          }
        }
      }
      
      setLoading(false);
    } catch (error) {
      // Error silencioso
      setLoading(false);
    }
  };

  const handleToggleMode = async (phone, isHuman) => {
    try {
      await toggleHumanMode(phone, isHuman);
      setContacts(prev => prev.map(c => 
        c.phone === phone ? { ...c, isHumanMode: isHuman } : c
      ));
    } catch (error) {
      // Error silencioso
    }
  };

  const filteredContacts = contacts
    .filter(contact => {
      const searchFields = [
        contact.phone,
        contact.name || '',
        contact.email || ''
      ].join(' ').toLowerCase();
      return searchFields.includes(searchTerm.toLowerCase());
    })
    .sort((a, b) => {
      // Primero los de soporte (prioridad máxima)
      if (a.mode === 'support' && b.mode !== 'support') return -1;
      if (a.mode !== 'support' && b.mode === 'support') return 1;
      // Luego por última actividad
      return new Date(b.lastActivity) - new Date(a.lastActivity);
    });

  if (loading) {
    return <div className="w-96 bg-white border-r border-gray-200 flex items-center justify-center">
      <span className="text-gray-500">Cargando contactos...</span>
    </div>;
  }

  return (
    <div className="w-96 bg-white border-r border-gray-200 flex flex-col">
      <div className="p-6 border-b border-gray-200">
        <h2 className="text-lg font-light text-navetec-primary mb-4">CONTACTOS</h2>
        <input
          type="text"
          placeholder="Buscar..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full px-4 py-2 rounded-md border border-gray-300 focus:outline-none focus:border-navetec-primary"
        />
      </div>
      
      <div className="flex-1 overflow-y-auto">
        {filteredContacts.length === 0 ? (
          <div className="text-center py-8 text-gray-500">No hay contactos</div>
        ) : (
          filteredContacts.map(contact => (
            <div
              key={contact.phone}
              className={`flex items-center p-4 border-b cursor-pointer transition-all ${
                contact.mode === 'support' 
                  ? 'bg-orange-50 border-orange-200 hover:bg-orange-100' 
                  : selectedContact?.phone === contact.phone 
                    ? 'bg-gray-100 border-gray-100 border-l-4' 
                    : 'border-gray-100 hover:bg-gray-50'
              }`}
              style={{
                borderLeftColor: contact.mode === 'support' 
                  ? '#EA580C'
                  : selectedContact?.phone === contact.phone 
                    ? '#00567D'
                    : 'transparent',
                borderLeftWidth: contact.mode === 'support' ? '4px' : selectedContact?.phone === contact.phone ? '4px' : '0'
              }}
              onClick={() => onSelectContact(contact)}
            >
              <div className="relative mr-4">
                <div 
                  className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm"
                  style={{ 
                    backgroundColor: contact.mode === 'support' ? '#EA580C' : '#00567D' 
                  }}
                >
                  {contact.mode === 'support'
                    ? '👤'
                    : contact.name
                      ? contact.name.charAt(0).toUpperCase()
                      : contact.phone.slice(-2)
                  }
                </div>
                {contact.mode === 'support' && (
                  <div className="absolute -top-1 -right-1 w-2 h-2 bg-orange-600 rounded-full animate-pulse"></div>
                )}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <div className={`font-medium ${contact.mode === 'support' ? 'text-orange-700' : 'text-navetec-primary'}`}>
                    {contact.name || contact.phone}
                  </div>
                  {contact.mode === 'support' && (
                    <span className="text-xs bg-orange-600 text-white px-2 py-0.5 rounded">
                      Soporte
                    </span>
                  )}
                  {contact.dataCollected && (
                    <span className="text-xs bg-green-600 text-white px-2 py-0.5 rounded">
                      ✓
                    </span>
                  )}
                </div>

                {/* Línea de información del contacto */}
                <div className={`text-xs ${contact.mode === 'support' ? 'text-orange-600' : 'text-gray-500'}`}>
                  {contact.name && contact.phone !== contact.name && (
                    <div className="truncate">{contact.phone}</div>
                  )}
                  {contact.email && (
                    <div className="truncate">{contact.email}</div>
                  )}
                </div>

                {/* Último mensaje */}
                <div className={`text-sm truncate ${contact.mode === 'support' ? 'text-orange-600' : 'text-gray-500'}`}>
                  {contact.lastMessage?.text.substring(0, 30)}...
                </div>
              </div>
              <button
                className="px-3 py-1 rounded-md text-xs font-medium transition-all"
                style={{
                  backgroundColor: contact.mode === 'support' 
                    ? '#EA580C' 
                    : contact.isHumanMode 
                      ? '#00567D' 
                      : 'white',
                  color: contact.mode === 'support' || contact.isHumanMode ? 'white' : '#00567D',
                  border: contact.mode === 'support' || contact.isHumanMode ? 'none' : '1px solid #00567D'
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  handleToggleMode(contact.phone, !contact.isHumanMode);
                }}
              >
                {contact.mode === 'support' ? 'SOPORTE' : contact.isHumanMode ? 'HUMANO' : 'IA'}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default ContactsList;