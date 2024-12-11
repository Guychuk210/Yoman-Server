// src/index.ts
import express from 'express';
//import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import transcriptionRoutes from './routes/transcription';
import multer from 'multer';
import axios from 'axios';
import { Request, Response } from 'express';

// load env vars
dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

const upload = multer();
// Configure CORS options
const corsOptions = {
    origin: [
        'http://localhost:19006', // Default Expo web port
        'http://localhost:19000', // Default Expo development port
        'exp://localhost:19000', // Expo development URL
        'exp://192.168.1.*',     // Local network Expo URLs
        'http://192.168.1.*',     // Local network Expo URLs
        'http://192.168.10.119',     // Local network Expo URLs
        'http://localhost:5000', // Localhost server URL
        // Add any other URLs your app might use
    ],
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
};

// Apply CORS with options
app.use(cors(corsOptions));

// middleware
app.use(express.json());

// basic test route
app.get('/test', (req, res) => {
  res.json({ message: 'Server is running' });
});

app.listen(port, () => {
  console.log(`server running on port ${port}`);
});

//app.use('/api', transcriptionRoutes);


app.post('/transcribe', upload.single('audioFile'), async (req: Request, res: Response) => {
    console.log('Transcribe route hit');
    try {
        if (!req.file) {
            console.log('No audio file provided');
            return;
        }
         // Log file details
         console.log('[Server] File details:', {
            fieldname: req.file.fieldname,
            originalname: req.file.originalname,
            mimetype: req.file.mimetype,
            size: req.file.size,
            buffer: `Buffer of size: ${req.file.buffer.length}`
        });
        // Create form data for OpenAI API
        const formData = new FormData();
        formData.append('file', 
            new Blob([req.file.buffer], { type: req.file.mimetype }), 
            'audio.m4a'
        );
        formData.append('model', 'whisper-1');

        console.log('[Server] Preparing OpenAI request...');

        // Send to OpenAI Whisper API
        const whisperResponse = await axios.post(
            'https://api.openai.com/v1/audio/transcriptions',
            formData,
            {
                headers: {
                    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                    'Content-Type': 'multipart/form-data'
                }
            }
        );

        console.log('[Server] Received response from OpenAI:', whisperResponse.status);
        console.log('[Server] Response data:', whisperResponse.data.text);
        res.json({ transcript: whisperResponse.data.text });
    } catch (error) {
        console.error('Transcription error:', error);
    }
});