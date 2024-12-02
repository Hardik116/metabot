'use strict';

// Use dotenv to read .env vars into Node
require('dotenv').config();

// Debug log to verify environment variables are loading
console.log('Environment variables loaded:');
console.log('GEMINI_API_KEY:', process.env.GEMINI_API_KEY ? 'Set' : 'Not Set');
console.log('PORT:', process.env.PORT || 3000);
console.log('VERIFY_TOKEN:', process.env.VERIFY_TOKEN ? 'Set' : 'Not Set');
console.log('PAGE_ACCESS_TOKEN:', process.env.PAGE_ACCESS_TOKEN ? 'Set' : 'Not Set');

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

    // Returns a '200 OK' response to acknowledge receipt of the event
    res.status(200).send('EVENT_RECEIVED');
  } else {
    // Returns a '404 Not Found' if the event is not from an Instagram subscription
    res.sendStatus(404);
  }
});

// Handles message events from Instagram
async function handleMessage(senderPsid, receivedMessage) {
  let response;

  // Check if the message contains text
  if (receivedMessage.text) {
    const userMessage = receivedMessage.text;
    console.log(`Received message: ${userMessage}`);

    // Check if the message is related to your business (optional logic)
    const relevantKeywords = ['shoes', 'size', 'shipping', 'return', 'price', 'order', 'material'];
    const isRelevant = relevantKeywords.some((keyword) => userMessage.toLowerCase().includes(keyword));

    if (isRelevant) {
      // Send user message to Gemini for text response
      response = await getGeminiResponse(userMessage);
    } else {
      // Suggest relevant questions if message is not related to the business
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
                {
                  type: 'postback',
                  title: 'Yes!',
                  payload: 'yes',
                },
                {
                  type: 'postback',
                  title: 'No!',
                  payload: 'no',
                },
              ],
            },
          ],
        },
      },
    };
  }

  // Send the response message to Instagram via the API
  callSendAPI(senderPsid, response);
}

// Function to interact with Gemini API and get a response
async function getGeminiResponse(userMessage) {
  try {
    const options = {
      uri: 'https://api.gemini.com/v1/chat/completions', // Gemini API endpoint for chat completion
      method: 'POST',
      json: {
        model: 'gemini-model', // Specify Gemini model
        messages: [{ role: 'user', content: userMessage }],
        api_key: process.env.GEMINI_API_KEY, // Your Gemini API key
      },
    };

    // Send request to Gemini API
    const response = await new Promise((resolve, reject) => {
      request(options, (error, _response, body) => {
        if (error) {
          reject('Error fetching Gemini response');
        }
        resolve(body);
      });
    });

    return { text: response.choices[0].message.content };
  } catch (error) {
    console.error('Error fetching Gemini response:', error);
    return { text: 'Sorry, I could not process your request at the moment. Please try again later.' };
  }
}

// Handles postback events
function handlePostback(senderPsid, receivedPostback) {
  let response;

  // Get the payload for the postback
  let payload = receivedPostback.payload;

  if (payload === 'yes') {
    response = { text: 'Thanks!' };
  } else if (payload === 'no') {
    response = { text: 'Oops, try sending another image.' };
  }

  // Send the postback response
  callSendAPI(senderPsid, response);
}

// Sends the response to Instagram via the Send API
function callSendAPI(senderPsid, response) {
  const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

  // Construct the message body
  let requestBody = {
    recipient: {
      id: senderPsid,
    },
    message: response,
  };

  // Send the request to Instagram's Send API
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
