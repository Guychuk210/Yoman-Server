import express, { Router, Request, Response } from 'express';
import { transcribeAudio } from '../services/openai';
import fileUpload from 'express-fileupload';

// Create a router
const router = express.Router();
// NOT: const router = Router();  <-- This might be causing the issue

// Add a route to it
router.post('/transcribe', async (req: Request, res: Response) => {
        const audioFile = req.files?.audioFile;

        if(!audioFile){
           // return res.status(400).json({error: 'no audio file provided'});
        }
  // route handler code here
});

export default router;