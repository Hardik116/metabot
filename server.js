'use strict';

// Use dotenv to read .env vars into Node
require('dotenv').config();

// Debug log to verify environment variables are loading
console.log('Environment variables loaded:');
console.log('OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? 'Set' : 'Not Set');
console.log('PORT:', process.env.PORT || 3000);
console.log('VERIFY_TOKEN:', process.env.VERIFY_TOKEN ? 'Set' : 'Not Set');
console.log('PAGE_ACCESS_TOKEN:', process.env.PAGE_ACCESS_TOKEN ? 'Set' : 'Not Set');
console.log('MONGO_URI:', process.env.MONGO_URI ? 'Set' : 'Not Set');

const { OpenAI } = require('openai'); // Import OpenAI SDK
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // Use the API key from environment variables
});

// Imports dependencies and sets up http server
const request = require('request');
const express = require('express');
const mongoose = require('mongoose');
const { urlencoded, json } = require('body-parser');
const app = express();

// Parse application/x-www-form-urlencoded
app.use(urlencoded({ extended: true }));

// Parse application/json
app.use(json());

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});
const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.once('open', () => {
  console.log('Connected to MongoDB');
});

// Define the schema for messages
const messageSchema = new mongoose.Schema({
  senderId: String,
  message: String,
  timestamp: { type: Date, default: Date.now },
});

// Create a model
const Message = mongoose.model('Message', messageSchema);

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

  // Save the message to the database
  const messageText = receivedMessage.text || '[Attachment]';
  const newMessage = new Message({
    senderId: senderPsid,
    message: messageText,
  });

  // Save the message to MongoDB
  try {
    await newMessage.save();
    console.log('Sender message saved to MongoDB:', newMessage);
  } catch (error) {
    console.error('Error saving sender message:', error);
  }

  // Check if the message contains text
  if (receivedMessage.text) {
    const userMessage = receivedMessage.text;
    console.log(`Received message: ${userMessage}`);

    // Send user message to OpenAI for GPT response
    response = await getGPTResponse(userMessage);
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

// Function to interact with OpenAI API and get a response
async function getGPTResponse(userMessage) {
  try {
    const completion = await openai.chat.completions.create({
      messages: [{ role: 'user', content: userMessage }],
      model: 'gpt-4',
    });

    const gptResponse = completion.choices[0].message.content;

    return { text: gptResponse };
  } catch (error) {
    console.error('Error fetching GPT response:', error);
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
