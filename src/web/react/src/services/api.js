const API_BASE = '/api';

// Configuración para incluir cookies en todas las requests
const fetchWithCredentials = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    credentials: 'include', // Incluir cookies
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  });
  return response;
};

// ===== FUNCIONES DE AUTENTICACIÓN =====

export async function login(email, password) {
  const response = await fetchWithCredentials(`${API_BASE}/auth/login`, {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Error al iniciar sesión');
  }
  
  return response.json();
}

export async function logout() {
  const response = await fetchWithCredentials(`${API_BASE}/auth/logout`, {
    method: 'POST'
  });
  
  if (!response.ok) {
    throw new Error('Error al cerrar sesión');
  }
  
  return response.json();
}

export async function checkAuth() {
  const response = await fetchWithCredentials(`${API_BASE}/auth/me`);
  
  if (!response.ok) {
    if (response.status === 401) {
      return null; // No autenticado
    }
    throw new Error('Error verificando autenticación');
  }
  
  return response.json();
}

// ===== FUNCIONES EXISTENTES (actualizadas para usar fetchWithCredentials) =====

export async function fetchStats(date) {
  const url = date ? `${API_BASE}/stats/${date}` : `${API_BASE}/stats`;
  const response = await fetchWithCredentials(url);
  if (!response.ok) throw new Error('Error fetching stats');
  return response.json();
}

export async function fetchDates() {
  const response = await fetchWithCredentials(`${API_BASE}/dates`);
  if (!response.ok) throw new Error('Error fetching dates');
  return response.json();
}

export async function fetchContacts() {
  try {
    const logsResponse = await fetchWithCredentials(`${API_BASE}/logs/`);
    if (!logsResponse.ok) {
      if (logsResponse.status === 401) {
        window.location.href = '/';
        return [];
      }
      throw new Error('Error fetching logs');
    }
    const logs = await logsResponse.json();

    const humanStatesResponse = await fetchWithCredentials(`${API_BASE}/human-states`);
    const humanStates = humanStatesResponse.ok ? await humanStatesResponse.json() : {};

    // Obtener datos de usuario
    const userDataResponse = await fetchWithCredentials(`${API_BASE}/user-data`);
    const usersData = userDataResponse.ok ? await userDataResponse.json() : [];

    // Crear un mapa de datos de usuario para acceso rápido
    const userDataMap = {};
    usersData.forEach(userData => {
      userDataMap[userData.userId] = userData;
    });

    const processedContacts = processContactsFromLogs(logs, humanStates, userDataMap);

    return processedContacts;
  } catch (error) {
    // Error silencioso
    throw error;
  }
}

export async function toggleHumanMode(phone, isHumanMode, mode = null) {
  const body = mode ? { phone, mode } : { phone, isHumanMode };
  
  const response = await fetchWithCredentials(`${API_BASE}/human-states`, {
    method: 'POST',
    body: JSON.stringify(body)
  });
  
  if (!response.ok) {
    throw new Error('Error actualizando modo');
  }
  
  return response.json();
}

export async function sendMessage(phone, message) {
  const response = await fetchWithCredentials(`${API_BASE}/send-message`, {
    method: 'POST',
    body: JSON.stringify({ phone, message })
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.details || 'Error enviando mensaje');
  }
  
  return response.json();
}

export async function endConversation(phone) {
  const response = await fetchWithCredentials(`${API_BASE}/end-conversation`, {
    method: 'POST',
    body: JSON.stringify({ phone })
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.details || 'Error finalizando conversación');
  }
  
  return response.json();
}

function processContactsFromLogs(logs, humanStates, userDataMap = {}) {
  const contacts = {};
  
  const filteredLogs = logs.filter(log => {
    // Filtrar mensajes del sistema innecesarios
    if (log.type === 'SYSTEM' && log.message && 
        (log.message.includes('Modo HUMANO activo') || 
         log.message.includes('Modo SOPORTE activo') ||
         log.message.includes('Mensaje ignorado') ||
         log.message.includes('Conversación reiniciada por inactividad'))) {
      return false;
    }
    // Incluir mensajes con tipo USER, BOT, HUMAN, SYSTEM o CLIENTE (conversión legacy)
    return log.type === 'USER' || log.type === 'BOT' || log.type === 'HUMAN' || log.type === 'SYSTEM' || log.type === 'CLIENTE';
  });
  
  filteredLogs.forEach(log => {
    const phone = log.userId || 'Sin número';
    
    if (!contacts[phone]) {
      // Determinar el modo actual del contacto
      let mode = 'ai';
      let isHumanMode = false;
      
      if (humanStates[phone] === 'support') {
        mode = 'support';
        isHumanMode = false;
      } else if (humanStates[phone] === 'human' || humanStates[phone] === true) {
        mode = 'human';
        isHumanMode = true;
      }
      
      // Obtener datos del usuario si están disponibles
      const userData = userDataMap[phone] || {};

      contacts[phone] = {
        phone: phone,
        name: userData.name || null,
        email: userData.email || null,
        dataCollected: userData.dataCollected || false,
        messages: [],
        totalMessages: 0,
        userMessages: 0,
        botMessages: 0,
        firstContact: log.timestamp,
        lastActivity: log.timestamp,
        lastMessage: null,
        isHumanMode: isHumanMode,
        mode: mode
      };
    }
    
    // Los mensajes BOT se mantienen como BOT
    // Solo marcar como SYSTEM los que realmente son del sistema (no de conversación)
    let processedLog = {...log};
    
    contacts[phone].messages.push(processedLog);
    contacts[phone].totalMessages++;
    contacts[phone].lastActivity = log.timestamp;
    
    if (log.type === 'USER' || log.type === 'CLIENTE') {
      contacts[phone].userMessages++;
      contacts[phone].lastMessage = {
        text: log.message,
        time: log.timestamp,
        type: 'user'
      };
    } else if (log.type === 'BOT' || log.type === 'HUMAN') {
      contacts[phone].botMessages++;
      contacts[phone].lastMessage = {
        text: log.message,
        time: log.timestamp,
        type: log.type.toLowerCase()
      };
    }
  });
  
  return Object.values(contacts)
    .filter(contact => contact.phone !== 'Sin número')
    .sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
}

// Obtener reportes de conversaciones
export async function getReports(date) {
  const url = date 
    ? `${API_BASE}/reports/${date}`
    : `${API_BASE}/reports`;
    
  const response = await fetchWithCredentials(url);
  
  if (!response.ok) {
    throw new Error('Error al obtener reportes');
  }
  
  return response.json();
}

// Actualizar estado de venta
export async function updateSaleStatus(conversationId, data) {
  const response = await fetchWithCredentials(`${API_BASE}/reports/sale-status`, {
    method: 'POST',
    body: JSON.stringify({
      conversationId,
      ...data
    })
  });
  
  if (!response.ok) {
    throw new Error('Error al actualizar estado de venta');
  }
  
  return response.json();
}

// Obtener estadísticas de ventas
export async function getSalesStats(date) {
  const url = date 
    ? `${API_BASE}/sales-stats/${date}`
    : `${API_BASE}/sales-stats`;
    
  const response = await fetchWithCredentials(url);
  
  if (!response.ok) {
    throw new Error('Error al obtener estadísticas de ventas');
  }
  
  return response.json();
}

// Analizar conversación con IA
export async function analyzeConversation(messages) {
  const response = await fetchWithCredentials(`${API_BASE}/analyze-conversation`, {
    method: 'POST',
    body: JSON.stringify({ messages })
  });
  
  if (!response.ok) {
    throw new Error('Error al analizar conversación');
  }
  
  return response.json();
}

// ===== FUNCIONES DE GESTIÓN DE DATOS DE USUARIO =====

export async function getUserData() {
  const response = await fetchWithCredentials(`${API_BASE}/user-data`);

  if (!response.ok) {
    throw new Error('Error al obtener datos de usuarios');
  }

  return response.json();
}

export async function getUserDataById(userId) {
  const response = await fetchWithCredentials(`${API_BASE}/user-data/${userId}`);

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    throw new Error('Error al obtener datos del usuario');
  }

  return response.json();
}

// ===== FUNCIONES DE GESTIÓN DE CSV =====

export async function uploadCSV(formData) {
  const response = await fetch(`${API_BASE}/csv/upload`, {
    method: 'POST',
    credentials: 'include',
    body: formData
  });
  
  if (!response.ok) {
    const errorData = await response.json();
    const error = new Error(errorData.error || 'Error al cargar archivo CSV');
    error.response = { data: errorData };
    throw error;
  }
  
  return response.json();
}

export async function getUploadedCSVs() {
  const response = await fetchWithCredentials(`${API_BASE}/csv/list`);
  
  if (!response.ok) {
    throw new Error('Error al obtener archivos CSV');
  }
  
  return response.json();
}

export async function deleteCSV(filename) {
  const response = await fetchWithCredentials(`${API_BASE}/csv/delete/${filename}`, {
    method: 'DELETE'
  });
  
  if (!response.ok) {
    throw new Error('Error al eliminar archivo CSV');
  }
  
  return response.json();
}