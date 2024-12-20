import fs from 'fs';
import FormData from 'form-data';
import axios from 'axios';
import path from 'path';

const LOCAL_URL = 'http://192.168.10.141:5000';

async function transcribeFile(filePath) {
  try {
    // First test if server is running
    console.log('Testing server connection...');
    try {
      const testResponse = await axios.get(`${LOCAL_URL}/test`);
      console.log('Server test response:', testResponse.data);
    } catch (error) {
      console.error('Server test failed:', error.message);
      return;
    }

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      console.error('File not found:', filePath);
      return;
    }
    console.log('File exists, size:', fs.statSync(filePath).size);

    const formData = new FormData();
    formData.append('audioFile', fs.createReadStream(filePath));

    console.log('Sending request to server...');
    const response = await axios.post(`${LOCAL_URL}/transcribe`, formData, {
      headers: {
        ...formData.getHeaders()
      }
    });

    console.log('Transcription:', response.data.transcript);
    return response.data.transcript;

  } catch (error) {
    console.error('Error details:', {
      message: error.message,
      response: error.response?.data
    });
  }
}

// Use absolute path to the file
const filePath = path.resolve('./test/journal.wav');
console.log('Attempting to transcribe file:', filePath);
transcribeFile(filePath);