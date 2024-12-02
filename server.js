'use strict';

// Use dotenv to read .env vars into Node
require('dotenv').config();

// Debug log to verify environment variables are loading
console.log('Environment variables loaded:');
console.log('OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? 'Set' : 'Not Set');
console.log('PORT:', process.env.PORT || 3000);
console.log('VERIFY_TOKEN:', process.env.VERIFY_TOKEN ? 'Set' : 'Not Set');
console.log('PAGE_ACCESS_TOKEN:', process.env.PAGE_ACCESS_TOKEN ? 'Set' : 'Not Set');

const { OpenAI } = require('openai'); // Import OpenAI SDK
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // Use the API key from environment variables
});

// Imports dependencies and sets up http server
const request = require('request');
const express = require('express');
const { urlencoded, json } = require('body-parser');
const app = express();

// Parse application/x-www-form-urlencoded
app.use(urlencoded({ extended: true }));

// Parse application/json
app.use(json());

// Respond with 'Hello World' when a GET request is made to the homepage
app.get('/', function (_req, res) {
  res.send('Hello World');
});

// Adds support for GET requests to our webhook
app.get('/webhook', (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

  // Parse the query params
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

// Creates the endpoint for your webhook to receive messages from Instagram
app.post('/webhook', (req, res) => {
  let body = req.body;

  if (body.object === 'instagram') {
    res.status(200).send('EVENT_RECEIVED'); // Acknowledge receipt quickly

    // Process events asynchronously
    body.entry.forEach(async function (entry) {
      let webhookEvent = entry.messaging[0];
      console.log(webhookEvent);

      let senderPsid = webhookEvent.sender.id;
      console.log('Sender PSID: ' + senderPsid);

      if (webhookEvent.message) {
        await handleMessage(senderPsid, webhookEvent.message);
      } else if (webhookEvent.postback) {
        handlePostback(senderPsid, webhookEvent.postback);
      }
    });
  } else {
    res.sendStatus(404);
  }
});

// Handles message events from Instagram
async function handleMessage(senderPsid, receivedMessage) {
  let response;

  if (receivedMessage.text) {
    const userMessage = receivedMessage.text;
    console.log(`Received message: ${userMessage}`);

    const relevantKeywords = ['shoes', 'size', 'shipping', 'return', 'price', 'order', 'material'];
    const isRelevant = relevantKeywords.some((keyword) => userMessage.toLowerCase().includes(keyword));

    if (isRelevant) {
      // Use OpenAI API for relevant questions
      response = await getGPTResponseWithTimeout(userMessage);
    } else {
      // Suggest relevant questions for unrelated messages
      response = {
        text: "It seems like your question is not directly related to our products. You can ask questions like: 'What types of shoes do you offer?', 'What is the return policy?', or 'How do I find my shoe size?'",
      };
    }
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

// Function to interact with OpenAI API and get a response with a timeout
async function getGPTResponseWithTimeout(userMessage) {
  const timeout = 5000; // 5 seconds
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const completion = await openai.chat.completions.create(
      {
        messages: [{ role: 'user', content: userMessage }],
        model: 'gpt-3.5-turbo-0125',
      },
      { signal: controller.signal }
    );

    clearTimeout(timeoutId);
    return { text: completion.choices[0].message.content };
  } catch (error) {
    console.error('Error fetching GPT response:', error);
      return { text: 'Sorry, an error occurred while processing your request. Please try again.' };
    
  }
}

// Handles postback events
function handlePostback(senderPsid, receivedPostback) {
  let response;

  let payload = receivedPostback.payload;

  if (payload === 'yes') {
    response = { text: 'Thanks!' };
  } else if (payload === 'no') {
    response = { text: 'Oops, try sending another image.' };
  }

  callSendAPI(senderPsid, response);
}

// Sends the response to Instagram via the Send API
function callSendAPI(senderPsid, response) {
  const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

  let requestBody = {
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
    (err, _res, _body) => {
      if (!err) {
        console.log('Message sent!');
      } else {
        console.error('Unable to send message:', err);
      }
    }
  );
}

// Set the default port and start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
