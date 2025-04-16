#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express, { Request, Response } from "express";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
// Fixed chalk import for ESM
import chalk from 'chalk';

// Add cors import
import cors from 'cors';

interface ArchitectureInquiryData {
  question: string;
  questionNumber: number;
  totalQuestions: number;
  answer?: string;
  nextQuestionNeeded: boolean;
  architectureComponent?: string;
  architectureTier?: 'infrastructure' | 'platform' | 'application' | 'data' | 'security' | 'operations';
}

interface ArchitectureState {
  questionHistory: ArchitectureInquiryData[];
  architectureComponents: string[];
  serviceTiers: Record<string, string[]>;
}

const AZURE_ARCHITECTURE_TOOL: Tool = {
  name: "design_azure_architecture",
  description: `A tool for designing Azure cloud architectures through guided questions.
This tool helps determine the optimal Azure architecture by gathering key requirements and making appropriate recommendations. The calling agent maintains the state between calls.

Parameters explained:
- question: The current question being asked
- questionNumber: Current question number in sequence
- totalQuestions: Estimated total questions needed
- answer: The user's response to the question (if available)
- nextQuestionNeeded: True if more questions are needed
- architectureComponent: The specific Azure component being suggested
- architectureTier: Which tier this component belongs to (infrastructure, platform, application, data, security, operations)
- state: Used to track progress between calls

Basic state structure:
{
  "questionHistory": [],
  "architectureComponents": [],
  "architectureTiers": {
    "infrastructure": [],
    "platform": [],
    "application": [],
    "data": [],
    "security": [],
    "operations": []
  }
}

You should:
1. First start with understanding who the user is (role, motivations, company size, etc.) and what they do
2. Learn about their business goals and requirements
3. Ask 1 to 2 questions at a time, in order to not overload the user.
4. Ask follow-up questions to clarify technical needs
5. Identify specific requirements and technical constraints from user responses
6. Suggest appropriate Azure components for each tier
7. Ensure you cover all architecture tiers
8. Follow Azure Well-Architected Framework principles (reliability, security, cost, operational excellence, performance efficiency)
9. Keep track of components you've suggested using the state object`,
  inputSchema: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description: "The current question being asked"
      },
      questionNumber: {
        type: "integer",
        description: "Current question number",
        minimum: 1
      },
      totalQuestions: {
        type: "integer",
        description: "Estimated total questions needed",
        minimum: 1
      },
      answer: {
        type: "string",
        description: "The user's response to the question"
      },
      nextQuestionNeeded: {
        type: "boolean",
        description: "Whether another question is needed"
      },
      architectureComponent: {
        type: "string",
        description: "Specific Azure component being suggested"
      },
      architectureTier: {
        type: "string",
        enum: ["infrastructure", "platform", "application", "data", "security", "operations"],
        description: "Which architectural tier this component belongs to"
      },
      state: {
        type: "object",
        description: "The complete architecture state from the previous request",
        properties: {
          questionHistory: {
            type: "array",
            description: "Complete history of all questions asked",
            items: {
              type: "object"
            }
          },
          architectureComponents: {
            type: "array",
            description: "All architecture components suggested so far",
            items: {
              type: "string"
            }
          },
          serviceTiers: {
            type: "object",
            description: "Components organized by architecture tier",
            additionalProperties: {
              type: "array",
              items: {
                type: "string"
              }
            }
          }
        }
      }
    },
    required: ["question", "questionNumber", "totalQuestions", "nextQuestionNeeded", "state"]
  }
};

const server = new Server(
  {
    name: "cloud-architect",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [AZURE_ARCHITECTURE_TOOL],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "design_azure_architecture") {
    try {
      const data = request.params.arguments as Record<string, unknown>;
      
      const input = {
        question: data.question as string,
        questionNumber: data.questionNumber as number,
        totalQuestions: data.totalQuestions as number,
        nextQuestionNeeded: data.nextQuestionNeeded as boolean,
        answer: data.answer as string | undefined,
        architectureComponent: data.architectureComponent as string | undefined,
        architectureTier: data.architectureTier as 'infrastructure' | 'platform' | 'application' | 'data' | 'security' | 'operations' | undefined,
      };

      // Get state from client
      const state = data.state as ArchitectureState;

      // Return minimal information, no metrics
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            display_text: input.question,
            questionNumber: input.questionNumber,
            totalQuestions: input.totalQuestions,
            nextQuestionNeeded: input.nextQuestionNeeded,
            state: state // Pass the state back to client unchanged
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
            status: 'failed'
          }, null, 2)
        }],
        isError: true
      };
    }
  }

  return {
    content: [{
      type: "text",
      text: `Unknown tool: ${request.params.name}`
    }],
    isError: true
  };
});

async function runServer() {
  // Check if SSE transport is requested
  const useSSE = process.argv.includes('--sse');
  const port = parseInt(process.argv.find(arg => arg.startsWith('--port='))?.split('=')[1] || '8000');
  
  if (useSSE) {
    const app = express();
    
    // Add CORS middleware
    app.use(cors());
    
    // Add basic error handling
    app.use((err: any, req: Request, res: Response, next: Function) => {
      console.error('Express error:', err);
      res.status(500).send('Internal Server Error');
    });
    
    // Add a health check endpoint
    app.get('/health', (_, res) => {
      res.status(200).send('Cloud Architect MCP Server is running');
    });
    
    // to support multiple simultaneous connections we have a lookup object from
    // sessionId to transport
    const transports: {[sessionId: string]: SSEServerTransport} = {};

    app.get("/sse", async (req: Request, res: Response) => {
      console.error(`SSE connection request received from ${req.ip}`);
      try {
        const transport = new SSEServerTransport('/messages', res);
        transports[transport.sessionId] = transport;
        res.on("close", () => {
          console.error(`SSE connection closed for session ${transport.sessionId}`);
          delete transports[transport.sessionId];
        });
        await server.connect(transport);
        console.error(`SSE connection established for session ${transport.sessionId}`);
      } catch (error) {
        console.error('Error establishing SSE connection:', error);
        res.status(500).send('Failed to establish SSE connection');
      }
    });

    app.post("/messages", async (req: Request, res: Response) => {
      const sessionId = req.query.sessionId as string;
      console.error(`Message received for session ${sessionId}`);
      const transport = transports[sessionId];
      if (transport) {
        try {
          await transport.handlePostMessage(req, res);
        } catch (error) {
          console.error(`Error handling message for session ${sessionId}:`, error);
          res.status(500).send('Error processing message');
        }
      } else {
        console.error(`No transport found for session ${sessionId}`);
        res.status(400).send('No transport found for sessionId');
      }
    });

    app.listen(port, () => {
      console.error(`Cloud Architect MCP Server running on SSE at http://localhost:${port}`);
      console.error(`To connect, use the /sse endpoint`);
      console.error(`Health check available at http://localhost:${port}/health`);
    });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Cloud Architect MCP Server running on stdio");
  }
}

runServer().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});