const axios = require('axios');
const express = require('express');
const ngrok = require('ngrok');
const app = express();

// Replace with your actual Instagram Business Account ID and Page Access Token
const instagramBusinessAccountId = '126174470583595';
const pageAccessToken = 'EAAOXCjztTBUBOZB13LO1KiB5ZAClGZCUJiQ9K9anWzhWz2WK3w339CgonVKpdXtlsVb4lrwD3Jvdc90vXM4hKlwrc7GpymGzVeGxQZAFXiQObMYk6zQmiI9sAlVEKrKQczTaMjuo2GBOZCk7CgTjOBGROuyT90Ce4zIihR4N7mT49AOJ5McdjiaHTsBeCiksZD';

// Add Express middleware to parse JSON requests
app.use(express.json());

// Function to send a reply message
async function sendReplyMessage(recipientId) {
  try {
    const response = await axios.post(`https://graph.facebook.com/v15.0/me/messages`, {
      recipient: { id: recipientId },
      message: { text: "Hi there! Thanks for reaching out to us. How can we help you today?" }
    }, {
      params: { access_token: pageAccessToken }
    });
    console.log('Message sent successfully:', response.data);
  } catch (error) {
    console.error('Error sending message:', error.response ? error.response.data : error.message);
  }
}

// Webhook verification endpoint
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const VERIFY_TOKEN = "hardikrathod";

  if (mode && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Webhook endpoint to receive messages
app.post('/webhook', async (req, res) => {
    const body = req.body;
  
    if (body.object === 'instagram') {
      body.entry.forEach(async (entry) => {
        // Update this part to correctly handle Instagram webhook structure
        const webhookEvent = entry.messaging?.[0];
        if (webhookEvent) {
          console.log('Webhook event received:', webhookEvent);
          
          if (webhookEvent.message && webhookEvent.message.text) {
            const senderId = webhookEvent.sender.id;
            console.log('New message received:', webhookEvent.message.text);
            
            // Send greeting message
            await sendReplyMessage(senderId);
          }
        }
      });
  
      res.status(200).send('EVENT_RECEIVED');
    } else {
      res.sendStatus(404);
    }
  });

// Start the server and ngrok
const PORT = 3000;
app.listen(PORT, async () => {
  console.log(`Server is running on port ${PORT}`);

  try {
    const url = await ngrok.connect(PORT);
    console.log('Ngrok tunnel is active!');
    console.log('Webhook URL:', `${url}/webhook`);
  } catch (error) {
    console.error('Error starting ngrok:', error);
  }
});
