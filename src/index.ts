// src/index.ts
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import axios from 'axios';
import { Request, Response } from 'express';
import OpenAI from 'openai';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { Readable } from 'stream';

// load env vars
dotenv.config();

// Add some debug logging
console.log('Firebase Config:', {
  type: process.env.FIREBASE_TYPE,
  project_id: process.env.FIREBASE_PROJECT_ID,
  // ... log other non-sensitive fields
});

// Initialize Firebase Admin
const serviceAccount = {
  type: process.env.FIREBASE_TYPE,
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: process.env.FIREBASE_AUTH_URI,
  token_uri: process.env.FIREBASE_TOKEN_URI,
  auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
  client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL
};

initializeApp({
  credential: cert(serviceAccount as any)
});

// Get Firestore instance
const db = getFirestore();

const app = express();
const port = process.env.PORT ? parseInt(process.env.PORT) : 5000;

// Define the complete MulterFile interface
interface MulterFile {
    fieldname: string;
    originalname: string;
    encoding: string;
    mimetype: string;
    size: number;
    stream: Readable;
    destination: string;
    filename: string;
    path: string;
    buffer: Buffer;
}

// Define the MulterRequest interface
interface MulterRequest extends Request {
    file?: MulterFile;
}

const upload = multer();
// Add API configuration at the top
const RENDER_URL = process.env.RENDER_URL; 
const LOCAL_URL = process.env.LOCAL_URL;
const API_BASE_URL = process.env.NODE_ENV === 'production' ? RENDER_URL : LOCAL_URL;
//const API_BASE_URL = LOCAL_URL;

// Initialize the OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Update CORS options to accept requests from your Render domain
const corsOptions = {
    origin: [
        // 'http://localhost:19006',
        // 'http://localhost:19000',
        // 'exp://localhost:19000',
        // 'exp://192.168.1.*',
        // 'http://localhost:4000',
        // 'http://192.168.56.1:4000',
        // RENDER_URL,
        // 'exp://192.168.56.1:19000',
        // 'exp://localhost:19000',
        // 'exp://127.0.0.1:19000',
        // 'exp://exp.host/*',           // Add this for Expo Go
        // 'https://exp.host/*',         // Add this for Expo Go
        // 'exp://*',                    // Add this to allow all Expo origins
        // 'https://*.exp.direct',       // Add this for Expo Go
        // 'http://10.50.9.3:4000',
        // 'http://192.168.56.1:4000',
        // 'exp://10.100.102.2:19000',
        // 'http://10.100.102.8:5000',
        // 'http://10.100.102.8:4000'
    ],
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization', 'entry-id', 'user-id', 'Content-Type'],
    credentials: true
};

// Apply CORS with options
app.use(cors(corsOptions));

// middleware
app.use(express.json());

// basic test route
app.get('/test', (req, res) => {
  res.json({ message: 'Server is running!!' });
  console.log("Recieved test request, Server is running!");
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

// Define style-specific instructions
const STYLE_INSTRUCTIONS = {
  casual: `Transform this entry into a casual, conversational diary style. 
    - Use casual language and little bit of everyday expressions
    - Include emojis where appropriate
    - Write as if talking to a close friend
    - Keep the tone light and personal
    - Organize thoughts in a clear, logical manner
    - You can use abbreviations and casual phrases
    - Try to write the diary as most people would write it
    - Generate the output in the same language as the input`,

  formal: `Generate the output in Hebrew!
    - Transform this entry into a formal diary style, don't include seperate paragraphs for date, location or subject.  just write the content.
    - Use professional and refined language
    - Maintain proper grammar and punctuation
    - Organize thoughts in a clear, logical manner
    - Avoid colloquialisms and slang
    - Focus on precise and articulate expression`,

  raw: `Keep this entry exactly as provided, with minimal modifications.
    - Maintain the original wording
    - Only correct obvious typos
    - Preserve the authentic voice and style
    - Keep all original expressions and phrases
    - Maintain the original flow of thoughts
    - Generate the output in the same language as the input`,

  reflective: `Transform this entry into a thoughtful, introspective style.
    - Include personal insights and realizations
    - Connect experiences to deeper meanings
    - Explore emotions and their implications
    - Consider lessons learned and growth
    - Include philosophical or contemplative elements
    - Generate the output in the same language as the input`,
};

// First endpoint for diary generation
app.post('/generate-diary', async (req: Request, res: Response) => {
  try {
    const { text, style, assistantId, entryId, userId, title } = req.body;
    
    console.log('=== Generate Diary Request ===');
    console.log('Received assistantId:', assistantId);
    console.log('User ID:', userId);
    console.log('Entry Title:', title);
    
    // Create user document if it doesn't exist
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      console.log('Creating new user document');
      await userRef.set({
        createdAt: Timestamp.now(),
      });
    }
    
    // If no assistantId is provided, create a new assistant
    let currentAssistantId = assistantId;
    if (!currentAssistantId) {
      console.log('No assistant ID found, creating new assistant...');
      const assistant = await openai.beta.assistants.create({
        name: "Personal Diary Assistant",
        instructions: `You are a diary assistant. Your role is to help transform thoughts and experiences into diary entries. In general, don't change text and style too much, but make it more organized and personal.
        Do Remember user preferences and personal context across all conversations, remember personal details about him as we will be retriving this information.
        Always maintain the same language as the input text.`,
        model: "gpt-4-turbo-preview",
        tools: []
      });
      currentAssistantId = assistant.id;
      
      console.log('New assistant created with ID:', currentAssistantId);
      
      await userRef.update({
        assistantId: currentAssistantId
      });
      
      console.log('Assistant ID stored in user document');
    } else {
      console.log('Using existing assistant:', currentAssistantId);
    }

    console.log('Creating thread for diary generation...');
    const thread = await openai.beta.threads.create();
    console.log('Thread created:', thread.id);

    console.log('Starting diary generation...');
    // Create thread and add initial message with style-specific instructions
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: `Style Instructions: ${STYLE_INSTRUCTIONS[style as keyof typeof STYLE_INSTRUCTIONS]}            
                Content to transform: ${text}`
    });

    // Start run and wait for completion
    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: currentAssistantId,
      temperature: 0.3
    });

    // Wait for the run to complete
    let runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
    while (runStatus.status !== 'completed') {
      await new Promise(resolve => setTimeout(resolve, 1000));
      runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
    }

    // Get diary entry
    const messages = await openai.beta.threads.messages.list(thread.id);
    const diaryEntry = messages.data[0].content[0].type === 'text' 
      ? messages.data[0].content[0].text.value 
      : '';
    console.log('Diary entry generated, length:', diaryEntry.length);

    console.log('Diary generation completed:', {
      entryLength: diaryEntry.length,
    });

    // Update Firestore with the generated content
    const entryRef = db.collection('users').doc(userId)
      .collection('diaries').doc(entryId);

    await entryRef.update({
      generatedEntry: diaryEntry,
      title: title,
      status: 'completed',
      updatedAt: Timestamp.now()
    });

    console.log('Firestore update completed');

    console.log('=== Generate Diary Request Completed ===\n');

    res.json({ 
      success: true,
      assistantId: currentAssistantId // Return assistantId for subsequent calls
    });

  } catch (error) {
    console.error('\n=== Generate Diary Error ===');
    console.error('Timestamp:', new Date().toISOString());
    console.error('Error:', error);
    console.error('=== Error End ===\n');
    res.status(500).json({ 
      error: 'Failed to generate diary entry',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Second endpoint for collecting information
app.post('/collect-information', async (req: Request, res: Response) => {
  try {
    const { text, assistantId, userId } = req.body;

    console.log('\n=== Collect Information Request Started ===');
    console.log('Timestamp:', new Date().toISOString());
    console.log('Request Details:', {
      userId,
      hasAssistantId: !!assistantId,
      textLength: text?.length
    });

    if (!assistantId) {
      throw new Error('Assistant ID is required for information collection');
    }

    console.log('Creating thread for information collection...');
    const thread = await openai.beta.threads.create();
    console.log('Thread created:', thread.id);

    console.log('Starting information extraction...');
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: `Please analyze this diary entry and extract important personal information about the user:
      ${text}
      
      Format the response as key facts about the user.`
    });

    const extractRun = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: assistantId,
      temperature: 0.2
    });

    // Wait for completion
    let extractRunStatus = await openai.beta.threads.runs.retrieve(thread.id, extractRun.id);
    while (extractRunStatus.status !== 'completed') {
      await new Promise(resolve => setTimeout(resolve, 1000));
      extractRunStatus = await openai.beta.threads.runs.retrieve(thread.id, extractRun.id);
    }
    
    const extractMessages = await openai.beta.threads.messages.list(thread.id);
    const extractedInfo = extractMessages.data[0].content[0].type === 'text' 
      ? extractMessages.data[0].content[0].text.value 
      : '';

    console.log('Information extraction completed');
    console.log('Extracted Information:');
    console.log('------------------------');
    console.log(extractedInfo);
    console.log('------------------------');

    if (extractedInfo) {
      console.log('Updating assistant memory...');
      await updateAssistantMemory(assistantId, extractedInfo);
      console.log('Assistant memory updated successfully');
    }

    console.log('=== Collect Information Request Completed ===\n');

    res.json({ 
      success: true, 
      extractedInfo 
    });

  } catch (error) {
    console.error('\n=== Collect Information Error ===');
    console.error('Timestamp:', new Date().toISOString());
    console.error('Error:', error);
    console.error('=== Error End ===\n');
    res.status(500).json({ 
      error: 'Failed to collect information',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Update the transcribe endpoint with the correct type
app.post('/transcribe', upload.single('audioFile'), async (req: MulterRequest, res: Response) => {
    console.log('=== Transcription Request Started ===');
    try {
        if (!req.file) {
            console.log('[ERROR] No audio file provided');
            return res.status(400).json({ error: 'No audio file provided' });
        }

        const userId = req.headers['user-id'] as string;
        const entryId = req.headers['entry-id'] as string;

        console.log('[INFO] Request details:', {
            userId,
            entryId,
            fileSize: req.file.size,
            mimeType: req.file.mimetype
        });

        if (!userId || !entryId) {
            console.log('[ERROR] Missing headers:', { userId, entryId });
            return res.status(400).json({ error: 'Missing required headers' });
        }

        // Create form data for OpenAI API
        const formData = new FormData();
        formData.append('file', 
            new Blob([req.file.buffer], { type: req.file.mimetype }), 
            'audio.m4a'
        );
        formData.append('model', 'whisper-1');

        console.log('[INFO] Sending request to OpenAI Whisper API...');

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

        console.log('[SUCCESS] Received Whisper response:', {
            status: whisperResponse.status,
            transcriptLength: whisperResponse.data.text.length
        });

        // Update Firestore with the transcript
        console.log('[INFO] Updating Firestore...');
        const docRef = db.collection('users').doc(userId)
            .collection('diaries').doc(entryId);

        await docRef.update({
            transcript: whisperResponse.data.text,
            status: 'draft',
            isProcessing: false,
            updatedAt: Timestamp.now(),
        });

        console.log('[SUCCESS] Firestore updated successfully');

        res.json({ 
            success: true,
            transcript: whisperResponse.data.text 
        });
        
        console.log('=== Transcription Request Completed ===');

    } catch (error) {
        console.error('[ERROR] Transcription failed:', error);
        
        // More detailed error logging
        if (axios.isAxiosError(error)) {
            console.error('[ERROR] OpenAI API error:', {
                status: error.response?.status,
                data: error.response?.data
            });
        }

        res.status(500).json({ 
            error: 'Transcription failed',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

app.get('/assistant-memory/:assistantId', async (req: Request, res: Response) => {
  try {
    const { assistantId } = req.params;
    
    if (!assistantId) {
      return res.status(400).json({ error: 'Assistant ID is required' });
    }

    console.log('Fetching memory for assistant:', assistantId);

    // Fetch the assistant details
    const assistant = await openai.beta.assistants.retrieve(assistantId);

    // Create a new thread to ask about learned preferences
    const thread = await openai.beta.threads.create();

    // Ask the assistant about what it knows
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: "Dont write anything else, just give me a list of all the personal information you know about me, nothing else.",
    });

    // Run the assistant
    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: assistantId,
      temperature: 0.3
    });

    // Wait for completion
    let runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
    while (runStatus.status !== 'completed') {
      await new Promise(resolve => setTimeout(resolve, 1000));
      runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
      
      if (runStatus.status === 'failed') {
        throw new Error('Assistant run failed');
      }
    }

    // Get the response
    const messages = await openai.beta.threads.messages.list(thread.id);
    const memory = messages.data[0].content[0].type === 'text' 
      ? messages.data[0].content[0].text.value 
      : 'No memory available';

    // Return both assistant details and memory summary
    res.json({
      assistant: {
        name: assistant.name,
        instructions: assistant.instructions,
        created: assistant.created_at
      },
      memory: memory
    });

  } catch (error) {
    console.error('Error fetching assistant memory:', error);
    res.status(500).json({ 
      error: 'Failed to fetch assistant memory',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Add this endpoint to handle memory updates
app.put('/assistant-memory/:assistantId', async (req: Request, res: Response) => {
  try {
    const { assistantId } = req.params;
    const { memory } = req.body;
    
    if (!assistantId) {
      return res.status(400).json({ error: 'Assistant ID is required' });
    }

    // Fetch the current assistant
    const assistant = await openai.beta.assistants.retrieve(assistantId);
    
    // Get current instructions and remove old memory updates
    const baseInstructions = assistant.instructions?.split('MEMORY UPDATE:')[0].trim() || '';

    // Create new instructions with updated memory
    const updatedInstructions = `${baseInstructions}

MEMORY UPDATE:
${memory}`;

    // Update the assistant with new instructions
    await openai.beta.assistants.update(assistantId, {
      instructions: updatedInstructions
    });

    res.json({ 
      success: true, 
      message: 'Memory updated successfully'
    });

  } catch (error) {
    console.error('Error updating assistant memory:', error);
    res.status(500).json({ 
      error: 'Failed to update assistant memory',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});