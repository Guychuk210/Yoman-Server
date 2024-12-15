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
const port = process.env.PORT ? parseInt(process.env.PORT) : 5000;

const upload = multer();
// Add API configuration at the top
const RENDER_URL = 'https://yoman-server.onrender.com'; 
const LOCAL_URL = 'http://192.168.10.68:5000';
const API_BASE_URL = process.env.NODE_ENV === 'production' ? RENDER_URL : LOCAL_URL;
//const API_BASE_URL = LOCAL_URL;

// Initialize the OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Update CORS options to accept requests from your Render domain
const corsOptions = {
    origin: [
        'http://localhost:19006',
        'http://localhost:19000',
        'exp://localhost:19000',
        'exp://192.168.1.*',
        'http://192.168.1.*',
        'http://192.168.10.119',
        'http://192.168.10.68',
        'http://localhost:5000',
        RENDER_URL, // Add your Render URL
        '*' // Allow all origins in development (be careful with this in production)
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
  res.json({ message: 'Server is running!' });
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on port ${port}`);
    console.log(`Server URL: ${API_BASE_URL}`);
});

//app.use('/api', transcriptionRoutes);

// First, let's create a helper function to update assistant instructions
async function updateAssistantMemory(assistantId: string, newInfo: string) {
  try {
    const assistant = await openai.beta.assistants.retrieve(assistantId);
    const currentInstructions = assistant.instructions || '';
    
    // Add new information to the memory section
    const updatedInstructions = `${currentInstructions}
    
MEMORY UPDATE:
${newInfo}`;

    // Update the assistant
    await openai.beta.assistants.update(assistantId, {
      instructions: updatedInstructions
    });
  } catch (error) {
    console.error('Error updating assistant memory:', error);
  }
}

// Modify the diary generation endpoint to update assistant memory
app.post('/generate-diary', async (req: Request, res: Response) => {
  try {
    const { text, style, assistantId } = req.body;
    console.log('=== Generate Diary Request ===');
    console.log('Style:', style);
    console.log('AssistantId:', assistantId);
    console.log('Text length:', text?.length);
    
    // If no assistantId is provided, create a new assistant
    let currentAssistantId = assistantId;
    if (!currentAssistantId) {
      console.log('Creating new assistant...');
      const assistant = await openai.beta.assistants.create({
        name: "Personal Diary Assistant",
        instructions: `You are a personal diary assistant. Your role is to help transform thoughts and experiences into diary entries. 
        Do Remember user preferences and personal context across all conversations, remember personal details about him as we will be retriving this information.
        Always maintain the same language as the input text.`,
        model: "gpt-4-turbo-preview",
        tools: []
      });
      currentAssistantId = assistant.id;
      console.log('New assistant created:', currentAssistantId);
    }

    // Create thread and add initial message
    const thread = await openai.beta.threads.create();
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: `Style: ${style}\nContent: ${text}`
    });

    // Start first run and wait for completion
    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: currentAssistantId
    });

    // Wait for the run to complete
    let runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
    while (runStatus.status !== 'completed') {
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
      runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
    }

    // Get diary entry
    const messages = await openai.beta.threads.messages.list(thread.id);
    const diaryEntry = messages.data[0].content[0].type === 'text' 
      ? messages.data[0].content[0].text.value 
      : '';
    console.log('Diary entry generated, length:', diaryEntry.length);

    // Generate title using the same assistant
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: "Generate a short, engaging title (maximum 5 words) for this diary entry."
    });

    const titleRun = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: currentAssistantId
    });

    // Wait for title generation to complete
    let titleRunStatus = await openai.beta.threads.runs.retrieve(thread.id, titleRun.id);
    while (titleRunStatus.status !== 'completed') {
      await new Promise(resolve => setTimeout(resolve, 1000));
      titleRunStatus = await openai.beta.threads.runs.retrieve(thread.id, titleRun.id);
    }

    // Get title
    const titleMessages = await openai.beta.threads.messages.list(thread.id);
    const title = titleMessages.data[0].content[0].type === 'text'
      ? titleMessages.data[0].content[0].text.value
      : '';

    // After generating the diary entry, extract and store important information
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: `Please analyze this diary entry and extract important personal information about the user:
      ${text}
      
      Format the response as key facts about the user.`
    });

    const extractRun = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: currentAssistantId
    });

    // Wait for completion and get the extracted information
    let extractRunStatus = await openai.beta.threads.runs.retrieve(thread.id, extractRun.id);
    while (extractRunStatus.status !== 'completed') {
      await new Promise(resolve => setTimeout(resolve, 1000));
      extractRunStatus = await openai.beta.threads.runs.retrieve(thread.id, extractRun.id);
    }

    const extractMessages = await openai.beta.threads.messages.list(thread.id);
    const extractedInfo = extractMessages.data[0].content[0].type === 'text' 
      ? extractMessages.data[0].content[0].text.value 
      : '';

    // Update assistant memory with new information
    if (extractedInfo) {
      await updateAssistantMemory(currentAssistantId, extractedInfo);
    }

    res.json({ 
      entry: diaryEntry,
      title: title,
      assistantId: currentAssistantId
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

app.get('/assistant-memory/:assistantId', async (req: Request, res: Response) => {
  try {
    const { assistantId } = req.params;
    
    if (!assistantId) {
      return res.status(400).json({ error: 'Assistant ID is required' });
    }

    // Fetch the assistant details
    const assistant = await openai.beta.assistants.retrieve(assistantId);

    // Parse the instructions to extract memory
    const instructions = assistant.instructions || '';
    const memoryUpdates = instructions
      .split('MEMORY UPDATE:')
      .slice(1)
      .join('\n')
      .trim();

    res.json({
      assistant: {
        name: assistant.name,
        created: assistant.created_at
      },
      memory: memoryUpdates || 'No personal information has been shared yet.'
    });

  } catch (error) {
    console.error('Error fetching assistant memory:', error);
    res.status(500).json({ 
      error: 'Failed to fetch assistant memory',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});