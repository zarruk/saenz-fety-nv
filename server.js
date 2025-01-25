import express from 'express';
import multer from 'multer';
import XLSX from 'xlsx';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fetch from 'node-fetch';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

        // Lista de unidades destino permitidas
        const unidadesPermitidas = [
            'LB', 'KG', '8G', '3G', 'S100G', 'S.10M', 'S1M', '10G', 
            '1G', '5G', '25G', '6G', '2G', '0.5G', 'SEM'
        ];

        const processedData = jsonData
            .map(row => {
                const unidadDestino = row['K']?.toString().trim().split(/\s+/).pop();
                
                // Solo procesar si la unidadDestino está en la lista de permitidas
                if (!unidadesPermitidas.includes(unidadDestino?.toUpperCase())) {
                    return null;
                }

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
        
        if (!workbook.SheetNames.includes('Hoja2')) {
            return res.status(400).json({ 
                error: 'Este archivo no contiene la hoja de ventas requerida (Hoja2)' 
            });
        }

        const worksheet = workbook.Sheets['Hoja2'];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, {header: 'A', range: 4});

        // Lista de unidades destino permitidas para ventas
        const unidadesPermitidas = ['LB', 'KG', 'GR', 'SEM'];

        const processedData = jsonData
            .map(row => {
                const palabraT = row['T']?.toString().trim().split(/\s+/).pop() || '';
                console.log('Fila original:', {
                    R: row['R'],
                    T: row['T'],
                    U: row['U'],
                    AA: row['AA']
                });
                console.log('Última palabra de T:', palabraT);
                
                // Determinar unidadOrigen
                let unidadOrigen;
                
                // Nueva validación para SBIN
                if (palabraT.toUpperCase() === 'SBIN') {
                    unidadOrigen = '1G';
                    console.log('Palabra es SBIN, asignando unidad:', unidadOrigen);
                } else if (palabraT.toUpperCase().startsWith('SB')) {
                    // Si la palabra empieza con SB (pero no es SBIN), tomamos la última palabra de U
                    unidadOrigen = row['U']?.toString().trim().split(/\s+/).pop() || '';
                    console.log('Palabra empieza con SB, tomando de U:', unidadOrigen);
                } else {
                    // Si no empieza con SB, usamos la última palabra de T
                    unidadOrigen = palabraT;
                    console.log('Palabra no empieza con SB, usando T:', unidadOrigen);
                }

                const unidadDestino = row['R']?.toString().trim().split(/\s+/).pop();
                
                console.log('Unidades procesadas:', {
                    unidadOrigen,
                    unidadDestino
                });

                // Solo procesar si la unidadDestino está en la lista de permitidas
                if (!unidadesPermitidas.includes(unidadDestino?.toUpperCase())) {
                    console.log('Unidad destino no permitida:', unidadDestino);
                    return null;
                }

                const result = {
                    nombre: row['R'],
                    unidadOrigen: unidadOrigen?.toUpperCase(),
                    unidadDestino: unidadDestino?.toUpperCase(),
                    valorOrigen: row['AA']
                };
                console.log('Objeto procesado:', result);
                return result;
            })
            .filter(row => row !== null && (row.nombre || row.valorOrigen));

        // Enviar al webhook de ventas (nueva URL)
        const webhookResponse = await fetch('https://workflows.ops.sandbox.cuentamono.com/webhook/b110575b-dfca-466a-9042-1c6539c6c4b8', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(processedData)
        });

        if (!webhookResponse.ok) {
            throw new Error('Error al enviar los datos al webhook de ventas');
        }

        res.json({ message: 'Archivo de ventas procesado y enviado correctamente' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
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