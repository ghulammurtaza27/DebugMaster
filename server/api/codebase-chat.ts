import { Router } from 'express';
import { aiService } from '../services/ai-service';
import { storage } from '../storage';
import { z } from 'zod';

const router = Router();

// Schema for chat messages
const chatMessageSchema = z.object({
  question: z.string().min(1, "Question is required"),
});

// Get conversation history
router.get('/', async (req, res) => {
  try {
    console.log('GET /api/codebase-chat - Fetching chat history');
    
    // Check authentication
    if (!req.user) {
      console.log('Authentication required - user not found in request');
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const userId = req.user.id;
    console.log(`Fetching chat history for user ${userId}`);
    const history = await storage.getChatHistory(userId);
    console.log(`Found ${history.length} messages in chat history`);
    
    res.json(history);
  } catch (error) {
    console.error('Error fetching chat history:', error);
    res.status(500).json({ error: 'Failed to fetch chat history' });
  }
});

// Send a message to chat with the codebase
router.post('/', async (req, res) => {
  try {
    console.log('POST /api/codebase-chat - Processing chat message');
    
    // Check authentication
    if (!req.user) {
      console.log('Authentication required - user not found in request');
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const userId = req.user.id;
    console.log(`Processing chat message for user ${userId}`);

    console.log('Request body:', req.body);
    
    // Validate the request
    const parsed = chatMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      console.log('Invalid request body:', parsed.error.errors);
      return res.status(400).json({ errors: parsed.error.errors });
    }

    // Get the question
    const { question } = parsed.data;
    console.log(`Processing question: "${question.substring(0, 50)}..."`);

    // Get repository settings
    const settings = await storage.getSettings();
    if (!settings) {
      console.log('GitHub settings not configured');
      return res.status(400).json({ error: 'GitHub settings not configured' });
    }

    console.log(`Using repository: ${settings.githubOwner}/${settings.githubRepo}`);
    
    // For testing purposes, let's try to use the AI service directly without chat history
    try {
      console.log('Sending question to AI service');
      const response = await aiService.chatWithCodebase(
        settings.githubOwner,
        settings.githubRepo,
        question,
        [] // Empty conversation history for testing
      );
      console.log('Received response from AI service');

      // Save the question and answer to history
      console.log('Saving question to chat history');
      await storage.saveChatMessage({
        userId,
        content: question,
        isUser: true,
        timestamp: new Date()
      });

      console.log('Saving answer to chat history');
      await storage.saveChatMessage({
        userId,
        content: response.answer,
        isUser: false,
        timestamp: new Date()
      });

      // Return the response
      console.log('Sending response to client');
      return res.json({
        answer: response.answer,
        contextSize: response.contextSize
      });
    } catch (aiError) {
      console.error('Error from AI service:', aiError);
      return res.status(500).json({ 
        error: aiError instanceof Error ? aiError.message : 'Failed to chat with codebase',
        details: 'AI service error'
      });
    }
  } catch (error) {
    console.error('Error in codebase chat:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to chat with codebase',
      details: 'General error'
    });
  }
});

// Clear chat history
router.delete('/', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    await storage.clearChatHistory(userId);
    res.json({ message: 'Chat history cleared' });
  } catch (error) {
    console.error('Error clearing chat history:', error);
    res.status(500).json({ error: 'Failed to clear chat history' });
  }
});

export default router; 