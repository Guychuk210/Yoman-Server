// server/src/services/openai.ts
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

// init openai - uses OPENAI_API_KEY from .env
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// define types for our responses
interface ProcessedRecording {
  transcript: string;
  analysis: string;
}

// handle audio transcription
export const transcribeAudio = async (audioFile: any): Promise<string> => {
  try {
    const transcript = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
    });

    return transcript.text;
  } catch (error) {
    console.error('whisper error:', error);
    throw new Error('failed to transcribe audio');
  }
};

// analyze with gpt4
// export const analyzeText = async (text: string): Promise<string> => {
//   try {
//     const completion = await openai.chat.completions.create({
//       model: 'gpt-4',
//       messages: [
//         {
//           role: 'system',
//           content: 'analyze audio recordings and provide natural, concise responses'
//         },
//         {
//           role: 'user', 
//           content: text
//         }
//       ],
//       temperature: 0.7,
//       max_tokens: 150
//     });

//     return completion.choices[0].message.content;
//   } catch (error) {
//     console.error('gpt error:', error);
//     throw new Error('failed to analyze text');
//   }
// };

// process entire recording
// export const processRecording = async (audioFile: any): Promise<ProcessedRecording> => {
//   try {
//     const transcript = await transcribeAudio(audioFile);
//     const analysis = await analyzeText(transcript);
    
//     return {
//       transcript,
//       analysis
//     };
//   } catch (error) {
//     console.error('processing error:', error);
//     throw error;
//   }
// };