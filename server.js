import express from 'express';
import multer from 'multer';
import XLSX from 'xlsx';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';

// Cargar variables de entorno
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configurar autenticación de Google
const auth = new JWT({
    email: process.env.GOOGLE_CLIENT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

const sheets = google.sheets({ version: 'v4', auth });
const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;

// Función para ordenar el Sheet
async function ordenarSheet() {
    try {
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            resource: {
                requests: [{
                    sortRange: {
                        range: {
                            sheetId: 0,  // ID de la primera hoja
                            startRowIndex: 1,  // Empezar después del encabezado
                            startColumnIndex: 0,  // Columna A
                            endColumnIndex: 1  // Solo columna A
                        },
                        sortSpecs: [{
                            dimensionIndex: 0,  // Columna A
                            sortOrder: 'ASCENDING'
                        }]
                    }
                }]
            }
        });
        console.log('Sheet ordenado exitosamente');
    } catch (error) {
        console.error('Error al ordenar sheet:', error);
    }
}

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

console.log('Iniciando servidor...');
console.log('Directorio público:', join(__dirname, 'public'));

app.use(cors());
app.use(express.static(join(__dirname, 'public')));

app.post('/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No se subió ningún archivo' });
        }

        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        
        if (!workbook.SheetNames.includes('Reporte')) {
            return res.status(400).json({ 
                error: 'Este no es el archivo de inventario o está en un formato incorrecto' 
            });
        }

        const worksheet = workbook.Sheets['Reporte'];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, {header: 'A', range: 5});

        const processedData = jsonData
            .map(row => {
                const unidadDestino = row['K']?.toString().trim().split(/\s+/).pop();
                
                return {
                    nombre: row['K'],
                    valor: row['L'],
                    unidadMedida: row['C']?.toString().toLowerCase().startsWith('sb') ? 
                        row['B']?.toString().trim().split(/\s+/).pop() : 
                        row['C'],
                    unidadDestino: unidadDestino?.toUpperCase()
                };
            })
            .filter(row => row !== null && (row.nombre || row.valor || row.unidadMedida));

        // Enviar al webhook
        const webhookResponse = await fetch('https://workflows.ops.sandbox.cuentamono.com/webhook/3d41e937-7504-4e86-be08-5c2f893a7b29', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(processedData)
        });

        if (!webhookResponse.ok) {
            throw new Error('Error al enviar los datos al webhook');
        }

        // Programar ordenamiento después de 10 segundos
        setTimeout(ordenarSheet, 10000);

        res.json({ message: 'Archivo procesado y enviado correctamente' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/upload-ventas', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No se subió ningún archivo' });
        }

        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        
        if (workbook.SheetNames.length < 2) {
            return res.status(400).json({ 
                error: 'Este archivo no contiene la hoja de ventas requerida' 
            });
        }

        const worksheet = workbook.Sheets[workbook.SheetNames[1]]; // Hoja 2
        const jsonData = XLSX.utils.sheet_to_json(worksheet, {header: 'A', range: 4}); // Comenzar desde la fila 5

        // Lista de unidades destino permitidas para ventas
        const unidadesPermitidas = ['LB', 'KG', 'GR', 'SEM'];

        const processedData = jsonData
            .map(row => {
                const palabraT = row['T']?.toString().trim().split(/\s+/).pop() || '';
                
                // Determinar unidadOrigen
                let unidadOrigen;
                if (palabraT.toUpperCase().startsWith('SB')) {
                    unidadOrigen = row['U']?.toString().trim().split(/\s+/).pop() || '';
                } else {
                    unidadOrigen = palabraT;
                }

                const unidadDestino = row['R']?.toString().trim().split(/\s+/).pop();
                
                if (!unidadesPermitidas.includes(unidadDestino?.toUpperCase())) {
                    return null;
                }

                return {
                    nombre: row['R'],
                    unidadOrigen: unidadOrigen?.toUpperCase(),
                    unidadDestino: unidadDestino?.toUpperCase(),
                    valorOrigen: row['AA']
                };
            })
            .filter(row => row !== null && (row.nombre || row.valorOrigen));

        // Enviar al webhook
        const webhookResponse = await fetch('https://workflows.ops.sandbox.cuentamono.com/webhook/6fbe03da-7a3b-416a-a107-a77f3fd649d3', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(processedData)
        });

        if (!webhookResponse.ok) {
            throw new Error('Error al enviar los datos al webhook de ventas');
        }

        // Programar ordenamiento después de 10 segundos
        setTimeout(ordenarSheet, 10000);

        res.json({ message: 'Archivo de ventas procesado y enviado correctamente' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 4000;
try {
    app.listen(PORT, () => {
        console.log('=================================');
        console.log(`✅ Servidor iniciado exitosamente`);
        console.log(`📡 Escuchando en puerto ${PORT}`);
        console.log('=================================');
    });
} catch (error) {
    console.error('❌ Error al iniciar el servidor:', error);
} 