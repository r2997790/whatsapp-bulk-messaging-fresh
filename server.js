const express = require('express');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Global state
let qrCodeData = null;
let isClientReady = false;
let messageStats = { sent: 0, failed: 0, total: 0 };
let clientError = 'WhatsApp functionality requires additional setup in production environment';
let isWhatsAppAvailable = false;

// Sample data for demo
let templates = [
  {
    id: 1,
    name: 'Welcome Message',
    content: 'Hello {{name}}, welcome to our service! We\'re excited to have you with us.',
    variables: ['name'],
    createdAt: new Date().toISOString()
  },
  {
    id: 2,
    name: 'Reminder',
    content: 'Hi {{name}}, this is a friendly reminder about {{event}} scheduled for {{date}}.',
    variables: ['name', 'event', 'date'],
    createdAt: new Date().toISOString()
  },
  {
    id: 3,
    name: 'Thank You',
    content: 'Thank you {{name}} for your recent purchase! We appreciate your business.',
    variables: ['name'],
    createdAt: new Date().toISOString()
  }
];

let contacts = [
  {
    id: 1,
    name: 'John Doe',
    phone: '1234567890',
    email: 'john@example.com',
    tags: ['customer', 'vip'],
    createdAt: new Date().toISOString()
  },
  {
    id: 2,
    name: 'Jane Smith',
    phone: '0987654321',
    email: 'jane@example.com',
    tags: ['prospect'],
    createdAt: new Date().toISOString()
  },
  {
    id: 3,
    name: 'Bob Johnson',
    phone: '5555551234',
    email: 'bob@example.com',
    tags: ['customer'],
    createdAt: new Date().toISOString()
  }
];

let contactGroups = [
  {
    id: 1,
    name: 'VIP Customers',
    description: 'High-value customers',
    contacts: [1],
    createdAt: new Date().toISOString()
  },
  {
    id: 2,
    name: 'Prospects',
    description: 'Potential customers',
    contacts: [2],
    createdAt: new Date().toISOString()
  },
  {
    id: 3,
    name: 'All Customers',
    description: 'All customer contacts',
    contacts: [1, 3],
    createdAt: new Date().toISOString()
  }
];

// Generate demo QR code for the UI
async function generateDemoQR() {
  try {
    qrCodeData = await qrcode.toDataURL('Demo Mode: Enhanced WhatsApp Messaging Platform - All UI features are functional for testing templates, contacts, and groups management.');
    console.log('✅ Demo QR code generated for UI testing');
  } catch (error) {
    console.error('❌ Failed to generate demo QR code:', error);
  }
}

// Initialize demo mode
generateDemoQR();

// Utility functions
function replaceTemplateVariables(template, variables) {
  let content = template.content;
  Object.keys(variables).forEach(key => {
    const regex = new RegExp(`{{${key}}}`, 'g');
    content = content.replace(regex, variables[key]);
  });
  return content;
}

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/status', (req, res) => {
  res.json({
    isReady: isClientReady,
    qrCode: qrCodeData,
    stats: messageStats,
    error: clientError,
    whatsappAvailable: isWhatsAppAvailable,
    mode: 'demo'
  });
});

// Template routes
app.get('/api/templates', (req, res) => {
  res.json(templates);
});

app.post('/api/templates', (req, res) => {
  const { name, content, variables } = req.body;
  const template = {
    id: Date.now(),
    name,
    content,
    variables: variables || [],
    createdAt: new Date().toISOString()
  };
  templates.push(template);
  res.json(template);
});

app.put('/api/templates/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const index = templates.findIndex(t => t.id === id);
  if (index !== -1) {
    templates[index] = { ...templates[index], ...req.body };
    res.json(templates[index]);
  } else {
    res.status(404).json({ error: 'Template not found' });
  }
});

app.delete('/api/templates/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const index = templates.findIndex(t => t.id === id);
  if (index !== -1) {
    templates.splice(index, 1);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Template not found' });
  }
});

// Contact routes
app.get('/api/contacts', (req, res) => {
  res.json(contacts);
});

app.post('/api/contacts', (req, res) => {
  const { name, phone, email, tags } = req.body;
  const contact = {
    id: Date.now(),
    name,
    phone,
    email,
    tags: tags || [],
    createdAt: new Date().toISOString()
  };
  contacts.push(contact);
  res.json(contact);
});

app.put('/api/contacts/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const index = contacts.findIndex(c => c.id === id);
  if (index !== -1) {
    contacts[index] = { ...contacts[index], ...req.body };
    res.json(contacts[index]);
  } else {
    res.status(404).json({ error: 'Contact not found' });
  }
});

app.delete('/api/contacts/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const index = contacts.findIndex(c => c.id === id);
  if (index !== -1) {
    contacts.splice(index, 1);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Contact not found' });
  }
});

// Group routes
app.get('/api/groups', (req, res) => {
  res.json(contactGroups);
});

app.post('/api/groups', (req, res) => {
  const { name, description, contacts } = req.body;
  const group = {
    id: Date.now(),
    name,
    description,
    contacts: contacts || [],
    createdAt: new Date().toISOString()
  };
  contactGroups.push(group);
  res.json(group);
});

app.put('/api/groups/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const index = contactGroups.findIndex(g => g.id === id);
  if (index !== -1) {
    contactGroups[index] = { ...contactGroups[index], ...req.body };
    res.json(contactGroups[index]);
  } else {
    res.status(404).json({ error: 'Group not found' });
  }
});

app.delete('/api/groups/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const index = contactGroups.findIndex(g => g.id === id);
  if (index !== -1) {
    contactGroups.splice(index, 1);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Group not found' });
  }
});

// Message sending routes (Demo mode)
app.post('/send-message', (req, res) => {
  const { phone, message, templateId, templateVariables } = req.body;
  
  // Demo mode - simulate message sending
  let phoneNumbers = [];
  if (phone.includes(',')) {
    phoneNumbers = phone.split(',').map(p => p.trim());
  } else {
    phoneNumbers = [phone];
  }

  let messageContent = message;
  
  // If using template
  if (templateId) {
    const template = templates.find(t => t.id === parseInt(templateId));
    if (template) {
      const variables = templateVariables ? JSON.parse(templateVariables) : {};
      messageContent = replaceTemplateVariables(template, variables);
    }
  }

  // Simulate delay and processing
  setTimeout(() => {
    messageStats.total = phoneNumbers.length;
    messageStats.sent = phoneNumbers.length;
    messageStats.failed = 0;

    const results = phoneNumbers.map(phoneNumber => ({
      phone: phoneNumber,
      status: 'demo-sent',
      message: messageContent
    }));

    res.json({
      success: true,
      results,
      stats: messageStats,
      demo: true,
      message: 'Demo mode: Messages simulated successfully! All UI features are working.'
    });
  }, 1500);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    mode: 'demo',
    features: {
      templates: templates.length,
      contacts: contacts.length,
      groups: contactGroups.length,
      ui: 'fully_functional'
    }
  });
});

// Error handling
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({ 
    error: 'Internal server error',
    message: error.message 
  });
});

// Start server
app.listen(port, () => {
  console.log(`🚀 Enhanced WhatsApp Messaging Platform`);
  console.log(`📱 Server running on port ${port}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`✨ Mode: Demo (Full UI functionality)`);
  console.log(`📊 Features: Templates, Contacts, Groups, Analytics`);
  console.log(`🎨 UI: Modern glassmorphism design`);
});
