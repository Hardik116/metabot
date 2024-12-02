'use strict';

// Load environment variables
require('dotenv').config();

// Debug log for environment variables
console.log('Environment variables loaded:');
console.log('HUGGINGFACE_API_KEY:', process.env.HUGGINGFACE_API_KEY ? 'Set' : 'Not Set');
console.log('PORT:', process.env.PORT || 3000);
console.log('VERIFY_TOKEN:', process.env.VERIFY_TOKEN ? 'Set' : 'Not Set');
console.log('PAGE_ACCESS_TOKEN:', process.env.PAGE_ACCESS_TOKEN ? 'Set' : 'Not Set');

// Import dependencies
const { HfInference } = require('@huggingface/inference');
const mongoose = require('mongoose');
const express = require('express');
const { urlencoded, json } = require('body-parser');
const request = require('request');

// Initialize Hugging Face Inference API
const hf = new HfInference(process.env.HUGGINGFACE_API_KEY);

// Initialize Express app
const app = express();
app.use(urlencoded({ extended: true }));
app.use(json());

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI);

console.log('Connected to MongoDB');

// Define Mongoose schemas and models
const userQuerySchema = new mongoose.Schema({
  senderId: String,
  query: String,
  timestamp: { type: Date, default: Date.now },
});

const aiResponseSchema = new mongoose.Schema({
  senderId: String,
  query: String,
  response: String,
  timestamp: { type: Date, default: Date.now },
});

const UserQuery = mongoose.model('UserQuery', userQuerySchema);
const AiResponse = mongoose.model('AiResponse', aiResponseSchema);

// Route: Home
app.get('/', (_req, res) => {
  res.send('Hello World');
});

// Route: Webhook Verification
app.get('/webhook', (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

  let mode = req.query['hub.mode'];
  let token = req.query['hub.verify_token'];
  let challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('WEBHOOK_VERIFIED');
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  }
});

// Route: Webhook Listener
app.post('/webhook', async (req, res) => {
  let body = req.body;

  if (body.object === 'instagram') {
    body.entry.forEach(function (entry) {
      let webhookEvent = entry.messaging[0];
      console.log(webhookEvent);

      let senderPsid = webhookEvent.sender.id;
      console.log('Sender PSID: ' + senderPsid);

      if (webhookEvent.message) {
        handleMessage(senderPsid, webhookEvent.message);
      } else if (webhookEvent.postback) {
        handlePostback(senderPsid, webhookEvent.postback);
      }
    });

    res.status(200).send('EVENT_RECEIVED');
  } else {
    res.sendStatus(404);
  }
});

// Function: Handle Messages
async function handleMessage(senderPsid, receivedMessage) {
  let response;

  if (receivedMessage.text) {
    const userMessage = receivedMessage.text;
    console.log(`Received message: ${userMessage}`);

    // Save user query to MongoDB
    const userQuery = new UserQuery({ senderId: senderPsid, query: userMessage });
    await userQuery.save();

    // Get AI response
    const hfResponse = await getHuggingFaceResponse(userMessage);

    // Save AI response to MongoDB
    const aiResponse = new AiResponse({
      senderId: senderPsid,
      query: userMessage,
      response: hfResponse.text,
    });
    await aiResponse.save();

    response = hfResponse;
  } else if (receivedMessage.attachments) {
    let attachmentUrl = receivedMessage.attachments[0].payload.url;
    response = {
      attachment: {
        type: 'template',
        payload: {
          template_type: 'generic',
          elements: [
            {
              title: 'Is this the right picture?',
              subtitle: 'Tap a button to answer.',
              image_url: attachmentUrl,
              buttons: [
                { type: 'postback', title: 'Yes!', payload: 'yes' },
                { type: 'postback', title: 'No!', payload: 'no' },
              ],
            },
          ],
        },
      },
    };
  }

  callSendAPI(senderPsid, response);
}

// Function: Get Hugging Face Response
async function getHuggingFaceResponse(userMessage) {
  try {
    const response = await hf.textGeneration({
      model: 'gpt2',
      inputs: userMessage,
      parameters: { max_new_tokens: 100, temperature: 0.7 },
    });

    const generatedText = response.generated_text;
    console.log('Hugging Face response:', generatedText);

    return { text: generatedText };
  } catch (error) {
    console.error('Error fetching Hugging Face response:', error);
    return { text: 'Sorry, I could not process your request at the moment.' };
  }
}

// Function: Handle Postback
function handlePostback(senderPsid, receivedPostback) {
  let payload = receivedPostback.payload;
  let response = payload === 'yes' ? { text: 'Thanks!' } : { text: 'Oops, try again.' };

  callSendAPI(senderPsid, response);
}

// Function: Send Response via API
function callSendAPI(senderPsid, response) {
  const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

  const requestBody = {
    recipient: { id: senderPsid },
    message: response,
  };

  request(
    {
      uri: 'https://graph.facebook.com/v12.0/me/messages',
      qs: { access_token: PAGE_ACCESS_TOKEN },
      method: 'POST',
      json: requestBody,
    },
    (err) => {
      if (!err) console.log('Message sent!');
      else console.error('Unable to send message:', err);
    }
  );
}

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
