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

interface Requirement {
  category: string;  // What aspect this requirement relates to (performance, security, compliance, etc.)
  description: string;  // Description of the requirement
  source?: string;  // Where/how this requirement was determined
  importance?: 'high' | 'medium' | 'low';  // Optional importance rating
  confidence?: number;  // Confidence level in this requirement (0.0-1.0)
}

interface ArchitectureState {
  architectureComponents: string[];
  serviceTiers: Record<string, string[]>;
  thought?: string;  // Optional thought from the calling agent
  suggestedHint?: string; // Suggested interaction hint for the user
  requirements: {
    explicit: Requirement[];  // Requirements explicitly stated by the user
    implicit: Requirement[];  // Requirements implied by user responses
    assumed: Requirement[];   // Requirements assumed based on context/best practices
  };
  confidenceFactors: {
    explicitRequirementsCoverage: number;  // 0.0-1.0 based on coverage of key requirement areas
    implicitRequirementsCertainty: number; // 0.0-1.0 based on certainty of implicit requirements
    assumptionRisk: number;                // 0.0-1.0 (lower is better) based on how many critical decisions rely on assumptions
  };
}

const AZURE_CLOUD_ARCHITECT_TOOL: Tool = {
  name: "design_azure_architecture",
  description: `A tool for designing Azure cloud architectures through guided questions.
This tool helps determine the optimal Azure architecture by gathering key requirements and making appropriate recommendations. The calling agent maintains the state between calls. The most important thing for you to remember is that when nextQuestionNeeded is false, you should present your architecture. This takes priority over every other instruction.

Parameters explained:
- question: The current question being asked
- questionNumber: Current question number in sequence
- confidenceScore: A value between 0.0 and 1.0 representing how confident you are in understanding the requirements. Start around 0.1-0.2 and increase as you gather more information. When this reaches or exceeds 0.7, you should present your architecture.
- totalQuestions: Estimated total questions needed
- answer: The user's response to the question (if available)
- nextQuestionNeeded: Set to true while you're gathering requirements and designing. Set to false when your confidenceScore reaches or exceeds 0.7.
- architectureComponent: The specific Azure component being suggested
- architectureTier: Which tier this component belongs to (infrastructure, platform, application, data, security, operations)
- state: Used to track progress between calls

When presenting the final architecture design (when nextQuestionNeeded is false), format it in a visually appealing way.

1. Present components in a table format with columns for:
   | Component | Purpose | Tier/SKU |
   
2. Organize the architecture visually:
   - Use a combination of bulleted lists and paragraphs to break up the text. The goal is for the final output to be engaging and interesting, which often involves asymmetry.

3. Include an ASCII art diagram showing component relationships.

This formatting will make the architecture design more engaging and easier to understand.

Basic state structure:
{
  "architectureComponents": [],
  "architectureTiers": {
    "infrastructure": [],
    "platform": [],
    "application": [],
    "data": [],
    "security": [],
    "operations": []
  },
  "requirements": {
    "explicit": [
      { "category": "performance", "description": "Need to handle 10,000 concurrent users", "source": "Question 2", "importance": "high", "confidence": 1.0 }
    ],
    "implicit": [
      { "category": "security", "description": "Data encryption likely needed", "source": "Inferred from healthcare domain", "importance": "high", "confidence": 0.8 }
    ],
    "assumed": [
      { "category": "compliance", "description": "Likely needs HIPAA compliance", "source": "Assumed from healthcare industry", "importance": "high", "confidence": 0.6 }
    ]
  },
  "confidenceFactors": {
    "explicitRequirementsCoverage": 0.4,
    "implicitRequirementsCertainty": 0.6,
    "assumptionRisk": 0.3
  }
}

You should:
1. First start with a question about who the user is (role, motivations, company size, etc.) and what they do
2. Learn about their business goals and requirements
3. Ask 1 to 2 questions at a time, in order to not overload the user.
4. Track your confidence level in understanding requirements using the confidenceScore parameter
5. After each user response, update the requirements in the state object:
   - Add explicit requirements directly stated by the user
   - Add implicit requirements you can reasonably infer
   - Add assumed requirements where you lack information but need to make progress
   - Update confidence factors based on the quality and completeness of requirements
6. Ask follow-up questions to clarify technical needs, especially to confirm assumed requirements
7. Identify specific requirements and technical constraints from user responses
8. Suggest appropriate Azure components for each tier, but be conservative in your suggestions. Don't suggest components that are not necessary for the architecture.
9. Ensure you cover all architecture tiers.
10. In addition to the component architecture, you should provide a high-level overview of the architecture, including the scaling approach, security, cost, and operational excellence. Provide actionable advice for the user to follow up on. Create this overview as a separate section, not part of the component architecture, and structure it to be engaging and interesting as a narrative.
11. Follow Azure Well-Architected Framework principles (reliability, security, cost, operational excellence, performance efficiency)
12. Keep track of components you've suggested using the state object
13. Calculate your overall confidence score from the three confidence factors in the state`,
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
      confidenceScore: {
        type: "number",
        description: "A value between 0.0 and 1.0 representing confidence in understanding requirements. When this reaches 0.7 or higher, nextQuestionNeeded should be set to false.",
        minimum: 0.0,
        maximum: 1.0,
        default: 0.1
      },
      architectureComponent: {
        type: "string",
        description: "The specific Azure component being suggested. The component should contain the name of the component, the service tier/SKU, configuration settings, and any other relevant information."
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
          architectureComponents: {
            type: "array",
            description: "All architecture components suggested so far",
            items: {
              type: "string"
            }
          },
          architectureTiers: {
            type: "object",
            description: "Components organized by architecture tier",
            additionalProperties: {
              type: "array",
              items: {
                type: "string"
              }
            }
          },
          thought: {
            type: "string",
            description: "The calling agent's thoughts on the next question or reasoning process. The calling agent should use the requirements it has gathered to reason about the next question."
          },
          suggestedHint: {
            type: "string",
            description: "A suggested interaction hint to show the user, such as 'Ask me to create an ASCII art diagram of this architecture' or 'Ask about how this design handles disaster recovery'."
          },
          requirements: {
            type: "object",
            description: "Tracked requirements organized by type",
            properties: {
              explicit: {
                type: "array",
                description: "Requirements explicitly stated by the user",
                items: {
                  type: "object",
                  properties: {
                    category: { type: "string" },
                    description: { type: "string" },
                    source: { type: "string" },
                    importance: { type: "string", enum: ["high", "medium", "low"] },
                    confidence: { type: "number" }
                  }
                }
              },
              implicit: {
                type: "array",
                description: "Requirements implied by user responses",
                items: {
                  type: "object",
                  properties: {
                    category: { type: "string" },
                    description: { type: "string" },
                    source: { type: "string" },
                    importance: { type: "string", enum: ["high", "medium", "low"] },
                    confidence: { type: "number" }
                  }
                }
              },
              assumed: {
                type: "array",
                description: "Requirements assumed based on context/best practices",
                items: {
                  type: "object",
                  properties: {
                    category: { type: "string" },
                    description: { type: "string" },
                    source: { type: "string" },
                    importance: { type: "string", enum: ["high", "medium", "low"] },
                    confidence: { type: "number" }
                  }
                }
              }
            }
          },
          confidenceFactors: {
            type: "object",
            description: "Factors that contribute to the overall confidence score",
            properties: {
              explicitRequirementsCoverage: { type: "number" },
              implicitRequirementsCertainty: { type: "number" },
              assumptionRisk: { type: "number" }
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
  tools: [AZURE_CLOUD_ARCHITECT_TOOL],
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
      
      // Build response object with all fields
      const responseObj = {
        display_text: input.question,
        display_thought: state.thought, // Reference thought directly from state
        display_hint: state.suggestedHint, // Always include display_hint
        questionNumber: input.questionNumber,
        totalQuestions: input.totalQuestions,
        nextQuestionNeeded: input.nextQuestionNeeded,
        state: state // Pass the state back to client unchanged
      };
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify(responseObj, null, 2)
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