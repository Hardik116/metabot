'use strict';

// Load environment variables
require('dotenv').config();

// Debug log for environment variables
console.log('Environment variables loaded:');
console.log('GEMINI_API_KEY:', process.env.GEMINI_API_KEY ? 'Set' : 'Not Set');
console.log('PORT:', process.env.PORT || 3000);
console.log('VERIFY_TOKEN:', process.env.VERIFY_TOKEN ? 'Set' : 'Not Set');
console.log('PAGE_ACCESS_TOKEN:', process.env.PAGE_ACCESS_TOKEN ? 'Set' : 'Not Set');

// Import dependencies
const mongoose = require('mongoose');
const express = require('express');
const { urlencoded, json } = require('body-parser');
const request = require('request');
const fetch = require('node-fetch');

// Initialize Express app
const app = express();
app.use(urlencoded({ extended: true }));
app.use(json());

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('Error connecting to MongoDB:', err));

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
app.post('/webhook', (req, res) => {
  let body = req.body;

  if (body.object === 'instagram') {
    // Iterates over each entry - there may be multiple if batched
    body.entry.forEach(function (entry) {
      // Gets the body of the webhook event
      let webhookEvent = entry.messaging[0];
      console.log(webhookEvent);

      // Get the sender ID (PSID or Instagram ID)
      let senderPsid = webhookEvent.sender.id;
      console.log('Sender PSID: ' + senderPsid);

      // Handle the received message
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
    const geminiResponse = await getGeminiResponse(userMessage);

    // Save AI response to MongoDB
    const aiResponse = new AiResponse({
      senderId: senderPsid,
      query: userMessage,
      response: geminiResponse.text,
    });
    await aiResponse.save();

    response = geminiResponse;
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

// Function: Get Gemini Response
async function getGeminiResponse(userMessage) {
  try {
    const response = await fetch('https://api.gemini-platform.com/v1/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GEMINI_API_KEY}`,
      },
      body: JSON.stringify({
        prompt: userMessage,
        max_tokens: 100,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.statusText}`);
    }

    const data = await response.json();
    const generatedText = data.generated_text;
    console.log('Gemini response:', generatedText);

    return { text: generatedText };
  } catch (error) {
    console.error('Error fetching Gemini response:', error);
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
