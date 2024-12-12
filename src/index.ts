// src/index.ts
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import axios from 'axios';
import { Request, Response } from 'express';
import OpenAI from 'openai';

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

app.post('/generate-diary', async (req: Request, res: Response) => {
    try {
        const { text, style } = req.body;
        console.log('Received request to generate diary with style:', style);
        console.log('Text:', text);

        // Define the type for stylePrompts
        const stylePrompts: { [key: string]: string } = {
            casual: "Rewrite this as a casual, friendly diary entry, using everyday language and a conversational tone in the same language as the given text:",
            formal: "Transform this into a formal, professional diary entry with sophisticated language and structure in the same language as the given text:",
            poetic: "Convert this into a poetic and creative diary entry, using metaphors and vivid imagery in the same language as the given text:",
            reflective: "Create a deep, reflective diary entry from this text, focusing on personal insights and emotional depth in the same language as the given text:"
        };

        const prompt = stylePrompts[style] || stylePrompts.casual;
        const response = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
                model: "gpt-4",
                messages: [
                    {
                        role: "system",
                        content: "You are a skilled diary writer who can transform spoken thoughts into beautiful diary entries."
                    },
                    {
                        role: "user",
                        content: `${prompt}\n\n${text}`
                    }
                ],
                temperature: 0.7,
            },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        const diaryEntry = response.data.choices[0].message.content;
        console.log('Done with entry text');
        
        // Then generate a title based on the diary entry
        const titleResponse = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
                model: "gpt-4",
                messages: [
                    {
                        role: "system",
                        content: "Generate a short, engaging title (maximum 5 words) for this diary entry:"
                    },
                    {
                        role: "user",
                        content: diaryEntry
                    }
                ],
                temperature: 0.7,
            },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        
        const title = titleResponse.data.choices[0].message.content;
        console.log('Done generating title:', title);
        
        res.json({ 
            entry: diaryEntry,
            title: title
        });

    } catch (error) {
        console.error('Diary generation error:', error);
        res.status(500).json({ error: 'Failed to generate diary entry' });
    }
});

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